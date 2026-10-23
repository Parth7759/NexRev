import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from '@/types/database.types'
import { decryptToken, encryptToken } from '@/lib/encryption'

export type TypedSupabaseClient = SupabaseClient<Database>

export interface GoogleBusinessAccount {
  name: string
  accountName: string
  type?: string
  role?: string
}

export interface GoogleLocationData {
  googleLocationId: string
  name: string
  address: string | null
  phone: string | null
  googlePlaceId: string | null
  googleAccountId: string
}

export interface GoogleReviewData {
  reviewId: string
  authorName: string
  authorPhotoUrl: string | null
  rating: number
  content: string
  reviewDate: string
  reply?: {
    comment: string
    updateTime?: string
  }
}

export interface GoogleReviewsResult {
  supported: boolean
  reviews: GoogleReviewData[]
  message?: string
}

export class GoogleApiError extends Error {
  code?: number
  status?: string
  details?: unknown

  constructor(message: string, code?: number, status?: string, details?: unknown) {
    super(message)
    this.name = 'GoogleApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

/**
 * Retrieves a valid, decrypted access token for the workspace.
 * Automatically refreshes the access token using the stored AES-256-GCM refresh token if expired.
 */
export async function getValidGoogleAccessToken(
  supabase: TypedSupabaseClient,
  workspaceId: string
): Promise<{ accessToken: string; accountId: string | null; accountName: string | null }> {
  const { data: integration, error } = await supabase
    .from('google_integrations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (error || !integration) {
    throw new GoogleApiError(
      'No Google Business Profile connection found for this workspace. Please connect your Google account first.'
    )
  }

  const expiresAtMs = new Date(integration.expires_at).getTime()
  const isExpiringSoon = Date.now() + 5 * 60 * 1000 >= expiresAtMs

  // If the current token is still valid (more than 5 minutes remaining), decrypt and return
  if (!isExpiringSoon && integration.access_token_encrypted) {
    try {
      const decryptedAccess = decryptToken(integration.access_token_encrypted)
      return {
        accessToken: decryptedAccess,
        accountId: integration.account_id,
        accountName: integration.account_name,
      }
    } catch {
      // If decryption fails, proceed to refresh token flow
    }
  }

  // Refresh token required for renewal
  if (!integration.refresh_token_encrypted) {
    throw new GoogleApiError(
      'Google authorization has expired and no refresh token is stored. Please click Reconnect Google Account.'
    )
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new GoogleApiError(
      'Google OAuth credentials missing on server. Please check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local.'
    )
  }

  let decryptedRefreshToken: string
  try {
    decryptedRefreshToken = decryptToken(integration.refresh_token_encrypted)
  } catch {
    throw new GoogleApiError(
      'Failed to decrypt stored Google refresh token. Please reconnect your account.'
    )
  }

  // Request new access token from Google
  let tokenData: {
    access_token?: string
    expires_in?: number
    refresh_token?: string
    error?: string
    error_description?: string
  }

  try {
    const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId.trim(),
        client_secret: clientSecret.trim(),
        refresh_token: decryptedRefreshToken.trim(),
        grant_type: 'refresh_token',
      }).toString(),
    })

    tokenData = await refreshRes.json()

    if (!refreshRes.ok || !tokenData.access_token) {
      const errorMsg =
        tokenData.error_description || tokenData.error || 'Failed to refresh Google access token'
      if (tokenData.error === 'invalid_grant') {
        throw new GoogleApiError(
          'Google authorization has been revoked or expired. Please reconnect your Google Business Profile account.',
          401,
          'INVALID_GRANT'
        )
      }
      throw new GoogleApiError(`Google token refresh failed: ${errorMsg}`, refreshRes.status)
    }
  } catch (err: unknown) {
    if (err instanceof GoogleApiError) throw err
    const msg = err instanceof Error ? err.message : 'Network error during Google token refresh'
    throw new GoogleApiError(`Failed to connect to Google OAuth server: ${msg}`)
  }

  // Encrypt the new access token and update database
  const newEncryptedAccess = encryptToken(tokenData.access_token)
  const newExpiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString()

  let newEncryptedRefresh = integration.refresh_token_encrypted
  if (tokenData.refresh_token) {
    newEncryptedRefresh = encryptToken(tokenData.refresh_token)
  }

  await supabase
    .from('google_integrations')
    .update({
      access_token_encrypted: newEncryptedAccess,
      refresh_token_encrypted: newEncryptedRefresh,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)

  return {
    accessToken: tokenData.access_token,
    accountId: integration.account_id,
    accountName: integration.account_name,
  }
}

/**
 * Fetches all accessible Google Business Profile accounts for the user.
 */
export async function fetchGoogleAccounts(accessToken: string): Promise<GoogleBusinessAccount[]> {
  const accounts: GoogleBusinessAccount[] = []
  let pageToken: string | undefined = undefined

  do {
    const url = new URL('https://mybusinessaccountmanagement.googleapis.com/v1/accounts')
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken)
    }

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    const body = await res.json().catch(() => null)

    if (!res.ok) {
      const err = body?.error
      const message = err?.message || res.statusText || 'Failed to list Google accounts'

      if (res.status === 403) {
        if (message.includes('has not been used') || message.includes('disabled')) {
          throw new GoogleApiError(
            'The My Business Account Management API is not enabled in Google Cloud project 248443327820. Please enable it in the Google Cloud Console.',
            403,
            'API_DISABLED'
          )
        }
        throw new GoogleApiError(
          `Google Business Profile API access denied: ${message}. Ensure your Google account is allowlisted.`,
          403,
          'PERMISSION_DENIED'
        )
      }

      throw new GoogleApiError(`Google Accounts API error: ${message}`, res.status)
    }

    interface RawAccount {
      name: string
      accountName?: string
      type?: string
      role?: string
    }

    if (body?.accounts && Array.isArray(body.accounts)) {
      for (const raw of body.accounts as RawAccount[]) {
        accounts.push({
          name: raw.name,
          accountName: raw.accountName || raw.name,
          type: raw.type,
          role: raw.role,
        })
      }
    }

    pageToken = body?.nextPageToken
  } while (pageToken)

  return accounts
}

/**
 * Formats a Google storefrontAddress into a single readable string.
 */
function formatStorefrontAddress(addr?: {
  addressLines?: string[]
  locality?: string
  administrativeArea?: string
  postalCode?: string
  regionCode?: string
}): string | null {
  if (!addr) return null
  const parts: string[] = []
  if (addr.addressLines && Array.isArray(addr.addressLines)) {
    const lines = addr.addressLines.filter(Boolean).join(', ')
    if (lines) parts.push(lines)
  }
  if (addr.locality) parts.push(addr.locality)
  if (addr.administrativeArea) parts.push(addr.administrativeArea)
  if (addr.postalCode) parts.push(addr.postalCode)
  if (addr.regionCode) parts.push(addr.regionCode)
  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * Fetches all locations for a specific Google Business Profile account.
 */
export async function fetchGoogleLocations(
  accessToken: string,
  accountName: string
): Promise<GoogleLocationData[]> {
  const locations: GoogleLocationData[] = []
  let pageToken: string | undefined = undefined

  do {
    const url = new URL(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations`
    )
    url.searchParams.set(
      'readMask',
      'name,title,storefrontAddress,phoneNumbers,metadata'
    )
    url.searchParams.set('pageSize', '100')
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken)
    }

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    const body = await res.json().catch(() => null)

    if (!res.ok) {
      const err = body?.error
      const message = err?.message || res.statusText || 'Failed to list Google locations'

      if (res.status === 403) {
        if (message.includes('has not been used') || message.includes('disabled')) {
          throw new GoogleApiError(
            'The My Business Business Information API is not enabled in Google Cloud project 248443327820. Please enable it in the Google Cloud Console.',
            403,
            'API_DISABLED'
          )
        }
        throw new GoogleApiError(
          `Google Business Profile Location API error: ${message}`,
          403,
          'PERMISSION_DENIED'
        )
      }

      throw new GoogleApiError(`Failed to fetch locations for ${accountName}: ${message}`, res.status)
    }

    interface RawLocation {
      name: string
      title?: string
      storefrontAddress?: {
        addressLines?: string[]
        locality?: string
        administrativeArea?: string
        postalCode?: string
        regionCode?: string
      }
      phoneNumbers?: {
        primaryPhone?: string
      }
      metadata?: {
        placeId?: string
      }
    }

    if (body?.locations && Array.isArray(body.locations)) {
      for (const raw of body.locations as RawLocation[]) {
        locations.push({
          googleLocationId: raw.name,
          name: raw.title || 'Untitled Location',
          address: formatStorefrontAddress(raw.storefrontAddress),
          phone: raw.phoneNumbers?.primaryPhone || null,
          googlePlaceId: raw.metadata?.placeId || null,
          googleAccountId: accountName,
        })
      }
    }

    pageToken = body?.nextPageToken
  } while (pageToken)

  return locations
}

/**
 * Maps Google's starRating string to an integer (1-5).
 */
function parseStarRating(ratingStr?: string): number {
  switch (ratingStr) {
    case 'FIVE':
      return 5
    case 'FOUR':
      return 4
    case 'THREE':
      return 3
    case 'TWO':
      return 2
    case 'ONE':
      return 1
    default:
      return 5
  }
}

/**
 * Attempts to fetch reviews for a Google Business Profile location.
 * Gracefully reports missing permissions or prerequisites if the Reviews API is not yet active.
 */
export async function fetchGoogleReviews(
  accessToken: string,
  accountName: string,
  locationName: string
): Promise<GoogleReviewsResult> {
  try {
    // In Business Information API v1, locationName is formatted as 'locations/{locationId}'.
    // In GMB v4 reviews, the parent endpoint is 'accounts/{accountId}/locations/{locationId}'.
    const normalizedAccount = accountName.startsWith('accounts/')
      ? accountName
      : `accounts/${accountName}`
    const normalizedLocation = locationName.startsWith('locations/')
      ? locationName
      : `locations/${locationName}`

    let pageToken: string | undefined = undefined
    let pageCount = 0
    const maxPages = 10 // Safety limit up to 500 reviews

    interface RawReview {
      name?: string
      reviewId?: string
      reviewer?: {
        displayName?: string
        profilePhotoUrl?: string
      }
      starRating?: string
      comment?: string
      createTime?: string
      updateTime?: string
      reviewReply?: {
        comment?: string
        updateTime?: string
      }
    }

    const reviews: GoogleReviewData[] = []

    do {
      const url = new URL(
        `https://mybusiness.googleapis.com/v4/${normalizedAccount}/${normalizedLocation}/reviews`
      )
      url.searchParams.set('pageSize', '50')
      url.searchParams.set('orderBy', 'updateTime desc')
      if (pageToken) {
        url.searchParams.set('pageToken', pageToken)
      }

      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      })

      const body = await res.json().catch(() => null)

      if (!res.ok) {
        const err = body?.error
        const message = err?.message || res.statusText || 'Reviews API error'

        if (res.status === 403 || res.status === 404) {
          return {
            supported: false,
            reviews,
            message: `Reviews API access pending (${err?.status || res.status}): ${message}. To enable live reviews sync, ensure 'Google My Business API' is enabled on project 248443327820.`,
          }
        }

        return {
          supported: false,
          reviews,
          message: `Reviews fetch returned status ${res.status}: ${message}`,
        }
      }

      if (body?.reviews && Array.isArray(body.reviews)) {
        for (const r of body.reviews as RawReview[]) {
          const resolvedReviewId =
            r.reviewId || (r.name ? r.name.split('/reviews/').pop() : '') || ''
          if (!resolvedReviewId) continue

          reviews.push({
            reviewId: resolvedReviewId,
            authorName: r.reviewer?.displayName || 'Google Customer',
            authorPhotoUrl: r.reviewer?.profilePhotoUrl || null,
            rating: parseStarRating(r.starRating),
            content: r.comment || '',
            reviewDate: r.updateTime || r.createTime || new Date().toISOString(),
            reply: r.reviewReply?.comment
              ? {
                  comment: r.reviewReply.comment,
                  updateTime: r.reviewReply.updateTime,
                }
              : undefined,
          })
        }
      }

      pageToken = body?.nextPageToken
      pageCount++
    } while (pageToken && pageCount < maxPages)

    return {
      supported: true,
      reviews,
      message: `Successfully fetched ${reviews.length} reviews from Google.`,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown review fetch error'
    return {
      supported: false,
      reviews: [],
      message: `Review synchronization skipped: ${msg}`,
    }
  }
}

export interface PublishReplyResult {
  success: boolean
  comment?: string
  updateTime?: string
  error?: string
}

/**
 * Publishes a reply to an external review via Google Business Profile API.
 * Handles expired tokens safely with auto-refresh and automatic retry on 401 Unauthorized.
 */
export async function publishGoogleReviewReply(
  supabase: TypedSupabaseClient,
  workspaceId: string,
  googleLocationName: string,
  externalReviewId: string,
  comment: string,
  googleAccountId?: string | null
): Promise<PublishReplyResult> {
  if (!comment || comment.trim() === '') {
    return { success: false, error: 'Reply comment text cannot be empty.' }
  }

  // Helper for single attempt
  async function attemptPublish(token: string): Promise<{ ok: boolean; status: number; data?: Record<string, unknown>; errorText?: string }> {
    // Parent format in GMB v4: accounts/{accountId}/locations/{locationId}
    let parentPath = googleLocationName.replace(/^\/+/, '')
    if (!parentPath.startsWith('accounts/') && googleAccountId) {
      const cleanAcc = googleAccountId.replace(/^\/+/, '')
      const normalizedAccount = cleanAcc.startsWith('accounts/') ? cleanAcc : `accounts/${cleanAcc}`
      const normalizedLoc = parentPath.startsWith('locations/') ? parentPath : `locations/${parentPath}`
      parentPath = `${normalizedAccount}/${normalizedLoc}`
    }
    const cleanReviewId = externalReviewId.replace(/^reviews\//, '')
    const url = `https://mybusiness.googleapis.com/v4/${parentPath}/reviews/${cleanReviewId}/reply`

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ comment: comment.trim() }),
    })

    if (!res.ok) {
      const errorText = await res.text()
      return { ok: false, status: res.status, errorText }
    }

    const data = await res.json()
    return { ok: true, status: res.status, data }
  }

  try {
    let { accessToken } = await getValidGoogleAccessToken(supabase, workspaceId)
    let result = await attemptPublish(accessToken)

    // If 401 Unauthorized, token might have been invalidated; force refresh token renewal and retry once
    if (!result.ok && result.status === 401) {
      try {
        // Clear cached expiration by retrieving a fresh token
        const fresh = await getValidGoogleAccessToken(supabase, workspaceId)
        accessToken = fresh.accessToken
        result = await attemptPublish(accessToken)
      } catch {
        return {
          success: false,
          error: 'Google authorization expired and automatic token renewal failed. Please reconnect your account.',
        }
      }
    }

    if (!result.ok) {
      let parsedError = result.errorText || `Google API error (status ${result.status})`
      try {
        const json = JSON.parse(result.errorText || '{}')
        parsedError = json.error?.message || parsedError
      } catch {
        // use raw
      }

      return {
        success: false,
        error: `Google review reply failed: ${parsedError}`,
      }
    }

    return {
      success: true,
      comment: typeof result.data?.comment === 'string' ? result.data.comment : comment.trim(),
      updateTime: typeof result.data?.updateTime === 'string' ? result.data.updateTime : new Date().toISOString(),
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown Google API network failure'
    return {
      success: false,
      error: `Failed to post reply to Google: ${msg}`,
    }
  }
}

