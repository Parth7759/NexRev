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
  createTime?: string | null
  updateTime?: string | null
  reply?: {
    comment: string
    updateTime?: string
  }
}

export interface FetchGoogleReviewsOptions {
  maxPages?: number
  pageSize?: number
  /**
   * Optional UTC ISO lower bound. Because Google returns reviews ordered by
   * `updateTime desc`, pagination stops early once a page reaches reviews
   * strictly older than `stopBeforeIso`.
   */
  stopBeforeIso?: string | null
  /**
   * When true alongside `stopBeforeIso`, omits reviews strictly older than
   * `stopBeforeIso` from the returned array.
   */
  filterToLookback?: boolean
}

export interface GoogleReviewsResult {
  supported: boolean
  reviews: GoogleReviewData[]
  pagesFetched?: number
  truncatedByLookback?: boolean
  truncatedByMaxPages?: boolean
  message?: string
  errorCode?: 'INVALID_GRANT' | 'NETWORK_ERROR' | 'QUOTA_EXCEEDED' | 'PERMISSION_DENIED' | 'API_DISABLED' | 'SERVER_MISCONFIGURED' | 'UNKNOWN'
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
  workspaceId: string,
  options?: { forceRefresh?: boolean }
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

  // If the current token is still valid (more than 5 minutes remaining) and forceRefresh is not requested
  if (!options?.forceRefresh && !isExpiringSoon && integration.access_token_encrypted) {
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
      if (refreshRes.status === 429) {
        throw new GoogleApiError(
          'Google OAuth token refresh rate limit reached. Please wait a few minutes before syncing again.',
          429,
          'QUOTA_EXCEEDED'
        )
      }
      if (tokenData.error === 'invalid_client') {
        throw new GoogleApiError(
          'Google OAuth client configuration rejected by Google. Please check server client credentials.',
          401,
          'SERVER_MISCONFIGURED'
        )
      }
      throw new GoogleApiError(`Google token refresh failed: ${errorMsg}`, refreshRes.status, 'REFRESH_FAILED')
    }
  } catch (err: unknown) {
    if (err instanceof GoogleApiError) throw err
    const msg = err instanceof Error ? err.message : 'Network error during Google token refresh'
    throw new GoogleApiError(`Failed to connect to Google OAuth server: ${msg}`, 503, 'NETWORK_ERROR')
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
  locationName: string,
  options?: FetchGoogleReviewsOptions
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
    const maxPages = Math.max(1, Math.min(20, Math.floor(options?.maxPages ?? 10)))
    const pageSize = Math.max(1, Math.min(50, Math.floor(options?.pageSize ?? 50)))
    const stopBeforeMs = options?.stopBeforeIso ? Date.parse(options.stopBeforeIso) : NaN
    const hasLookbackCutoff = Number.isFinite(stopBeforeMs)
    const filterToLookback = Boolean(options?.filterToLookback && hasLookbackCutoff)
    let reachedLookbackCutoff = false

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
      url.searchParams.set('pageSize', String(pageSize))
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

        if (res.status === 401) {
          return {
            supported: false,
            reviews,
            pagesFetched: pageCount,
            message: 'Google authorization expired during reviews fetch. Please reconnect your account.',
            errorCode: 'INVALID_GRANT',
          }
        }

        if (res.status === 429) {
          return {
            supported: false,
            reviews,
            pagesFetched: pageCount,
            message: 'Google Business Profile API rate limit exceeded. Please wait a few minutes before syncing again.',
            errorCode: 'QUOTA_EXCEEDED',
          }
        }

        if (res.status === 403 || res.status === 404) {
          const isApiDisabled = message.includes('has not been used') || message.includes('disabled')
          return {
            supported: false,
            reviews,
            pagesFetched: pageCount,
            message: isApiDisabled
              ? `Google My Business API is not enabled on Google Cloud project 248443327820. Please enable it in the Google Cloud Console.`
              : `Google Business Profile permission error: Access was denied (${message}). Ensure your account has manager or owner access to this location.`,
            errorCode: isApiDisabled ? 'API_DISABLED' : 'PERMISSION_DENIED',
          }
        }

        return {
          supported: false,
          reviews,
          pagesFetched: pageCount,
          message: `Reviews fetch returned status ${res.status}: ${message}`,
          errorCode: 'UNKNOWN',
        }
      }

      pageCount++

      if (body?.reviews && Array.isArray(body.reviews)) {
        for (const r of body.reviews as RawReview[]) {
          const resolvedReviewId =
            r.reviewId || (r.name ? r.name.split('/reviews/').pop() : '') || ''
          if (!resolvedReviewId) continue

          const reviewCreateTime = r.createTime || null
          const reviewUpdateTime = r.updateTime || null
          const effectiveDate = reviewUpdateTime || reviewCreateTime || new Date().toISOString()

          if (hasLookbackCutoff) {
            const updateMs = Date.parse(reviewUpdateTime || reviewCreateTime || '')
            if (Number.isFinite(updateMs) && updateMs < stopBeforeMs) {
              reachedLookbackCutoff = true
              if (filterToLookback) {
                continue
              }
            }
          }

          reviews.push({
            reviewId: resolvedReviewId,
            authorName: r.reviewer?.displayName || 'Google Customer',
            authorPhotoUrl: r.reviewer?.profilePhotoUrl || null,
            rating: parseStarRating(r.starRating),
            content: r.comment || '',
            reviewDate: effectiveDate,
            createTime: reviewCreateTime,
            updateTime: reviewUpdateTime,
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
      if (reachedLookbackCutoff) {
        break
      }
    } while (pageToken && pageCount < maxPages)

    const truncatedByMaxPages = Boolean(pageToken && !reachedLookbackCutoff && pageCount >= maxPages)

    return {
      supported: true,
      reviews,
      pagesFetched: pageCount,
      truncatedByLookback: reachedLookbackCutoff,
      truncatedByMaxPages,
      message: `Successfully fetched ${reviews.length} reviews from Google.`,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown review fetch error'
    return {
      supported: false,
      reviews: [],
      pagesFetched: 0,
      message: `Failed to connect to Google Reviews API: ${msg}. Please check your network connection and try again.`,
      errorCode: 'NETWORK_ERROR',
    }
  }
}

export interface PublishReplyResult {
  success: boolean
  comment?: string
  updateTime?: string
  error?: string
  errorCode?: string
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
        // Force refresh token renewal on 401 Unauthorized
        const fresh = await getValidGoogleAccessToken(supabase, workspaceId, { forceRefresh: true })
        accessToken = fresh.accessToken
        result = await attemptPublish(accessToken)
      } catch (refreshErr: unknown) {
        if (refreshErr instanceof GoogleApiError && refreshErr.status === 'INVALID_GRANT') {
          return {
            success: false,
            error: 'Google authorization has been revoked or expired. Please reconnect your Google Business Profile account.',
            errorCode: 'INVALID_GRANT',
          }
        }
        const refreshMsg = refreshErr instanceof Error ? refreshErr.message : 'Token refresh failed'
        return {
          success: false,
          error: `Google review reply failed: ${refreshMsg}`,
          errorCode: refreshErr instanceof GoogleApiError ? refreshErr.status : 'SERVER_ERROR',
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

export interface SingleReviewResult {
  success: boolean
  review?: GoogleReviewData
  error?: string
  errorCode?: string
}

/**
 * Fetches a single review from Google Business Profile API by resource name or account/location/review IDs.
 */
export async function fetchSingleGoogleReview(
  accessToken: string,
  resource:
    | string
    | {
        accountId: string
        locationId: string
        reviewId: string
      }
): Promise<SingleReviewResult> {
  try {
    let accountId = ''
    let locationId = ''
    let reviewId = ''

    if (typeof resource === 'string') {
      const clean = resource.replace(/^\/+/, '')
      const match = clean.match(/(?:accounts\/)?([^/]+)\/(?:locations\/)?([^/]+)\/(?:reviews\/)?([^/]+)/)
      if (match) {
        accountId = match[1]
        locationId = match[2]
        reviewId = match[3]
      } else {
        return { success: false, error: `Invalid Google review resource name format: "${resource}"` }
      }
    } else {
      accountId = resource.accountId.replace(/^accounts\//, '')
      locationId = resource.locationId.replace(/^locations\//, '')
      reviewId = resource.reviewId.replace(/^reviews\//, '')
    }

    const cleanReviewId = reviewId.replace(/^reviews\//, '')
    const url = `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/reviews/${cleanReviewId}`

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!res.ok) {
      const errorText = await res.text()
      let parsedMessage = `Status ${res.status}: ${res.statusText}`
      try {
        const json = JSON.parse(errorText)
        parsedMessage = json.error?.message || parsedMessage
      } catch {
        // use raw
      }

      return {
        success: false,
        error: `Failed to fetch single review from Google: ${parsedMessage}`,
        errorCode: res.status === 401 ? 'INVALID_GRANT' : res.status === 403 ? 'PERMISSION_DENIED' : 'UNKNOWN',
      }
    }

    const data = await res.json()
    const resolvedReviewId = data.reviewId || cleanReviewId

    return {
      success: true,
      review: {
        reviewId: resolvedReviewId,
        authorName: data.reviewer?.displayName || 'Google Customer',
        authorPhotoUrl: data.reviewer?.profilePhotoUrl || null,
        rating: parseStarRating(data.starRating),
        content: data.comment || '',
        reviewDate: data.updateTime || data.createTime || new Date().toISOString(),
        reply: data.reviewReply?.comment
          ? {
              comment: data.reviewReply.comment,
              updateTime: data.reviewReply.updateTime,
            }
          : undefined,
      },
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error fetching single review'
    return {
      success: false,
      error: msg,
      errorCode: 'NETWORK_ERROR',
    }
  }
}

export interface GoogleNotificationSetting {
  name?: string
  pubsubTopic?: string
  notificationTypes?: string[]
}

export type NotificationUpdateMaskField = 'pubsubTopic' | 'notificationTypes'

export interface GoogleNotificationSettingResult {
  success: boolean
  setting?: GoogleNotificationSetting
  httpStatus?: number
  errorCode?: string
  error?: string
  endpointUsed?: 'mybusinessnotifications_v1' | 'mybusiness_v4'
}

const VALID_GBP_PUBSUB_TOPIC_REGEX = /^projects\/[a-z0-9-]+\/topics\/[A-Za-z0-9-_.~+%]+$/

function normalizeNotificationAccountPath(accountName: string): string {
  const bare = (accountName || '').trim().replace(/^\/?accounts\//i, '').toLowerCase()
  if (!bare || /[\s/]/.test(bare)) {
    return ''
  }
  return `accounts/${bare}`
}

function parseGoogleErrorResponse(rawText: string, status: number): { errorCode: string; message: string } {
  let errorCode = `HTTP_${status}`
  let message = rawText || `Google API error (HTTP ${status})`

  try {
    const parsed = JSON.parse(rawText || '{}') as {
      error?: { status?: string; message?: string; code?: number }
    }
    if (parsed?.error?.status) {
      errorCode = parsed.error.status
    }
    if (parsed?.error?.message) {
      message = parsed.error.message
    }
  } catch {
    // Keep raw text fallback
  }

  // Scrub any accidental token material and bound length
  const sanitized = message
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/ya29\.[A-Za-z0-9\-._]+/g, '[REDACTED_TOKEN]')
    .replace(/1\/\/[A-Za-z0-9\-._]+/g, '[REDACTED_REFRESH_TOKEN]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 450)

  return { errorCode, message: sanitized || `Google API error (HTTP ${status})` }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = 15_000
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Retrieves the current Google Business Profile account notification settings (Pub/Sub topic and event types)
 * using the official My Business Notifications API v1 (https://mybusinessnotifications.googleapis.com/v1).
 * Never masks primary 400/401/403/429 responses with deprecated endpoint fallbacks.
 */
export async function getGoogleAccountNotificationSetting(
  accessToken: string,
  accountName: string,
  options?: { timeoutMs?: number }
): Promise<GoogleNotificationSettingResult> {
  const normalizedAccount = normalizeNotificationAccountPath(accountName)
  if (!normalizedAccount) {
    return {
      success: false,
      httpStatus: 400,
      errorCode: 'INVALID_ACCOUNT_ID',
      error: 'Invalid Google Business Profile account identifier.',
      endpointUsed: 'mybusinessnotifications_v1',
    }
  }

  const timeoutMs = options?.timeoutMs ?? 15_000

  // 1. Official Google My Business Notifications API v1 (Primary)
  let primaryFailure: GoogleNotificationSettingResult | null = null
  try {
    const notifyUrl = `https://mybusinessnotifications.googleapis.com/v1/${normalizedAccount}/notificationSetting`
    const res = await fetchWithTimeout(
      notifyUrl,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      },
      timeoutMs
    )

    if (res.ok) {
      const data = (await res.json()) as GoogleNotificationSetting
      return {
        success: true,
        setting: data,
        httpStatus: res.status,
        endpointUsed: 'mybusinessnotifications_v1',
      }
    }

    const rawText = await res.text()
    const parsed = parseGoogleErrorResponse(rawText, res.status)
    primaryFailure = {
      success: false,
      httpStatus: res.status,
      errorCode: parsed.errorCode,
      error: parsed.message,
      endpointUsed: 'mybusinessnotifications_v1',
    }

    // Never mask primary client/auth/permission/rate-limit errors with deprecated v4 fallback
    if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 429) {
      return primaryFailure
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error calling Notifications API v1'
    primaryFailure = {
      success: false,
      httpStatus: 503,
      errorCode: 'NETWORK_ERROR',
      error: msg,
      endpointUsed: 'mybusinessnotifications_v1',
    }
  }

  // 2. Fallback to GMB v4 ONLY if primary returned 404 (unsupported path) or 5xx/transport error
  if (primaryFailure && primaryFailure.httpStatus === 404) {
    try {
      const v4Url = `https://mybusiness.googleapis.com/v4/${normalizedAccount}/notificationSetting`
      const res = await fetchWithTimeout(
        v4Url,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        },
        timeoutMs
      )

      if (res.ok) {
        const data = (await res.json()) as GoogleNotificationSetting
        return {
          success: true,
          setting: data,
          httpStatus: res.status,
          endpointUsed: 'mybusiness_v4',
        }
      }
    } catch {
      // Preserve primary Notifications v1 diagnostic below
    }
  }

  return (
    primaryFailure || {
      success: false,
      httpStatus: 500,
      errorCode: 'UNKNOWN_ERROR',
      error: 'Failed to fetch notification setting.',
      endpointUsed: 'mybusinessnotifications_v1',
    }
  )
}

export interface UpdateNotificationSettingOptions {
  updateMask?: NotificationUpdateMaskField[]
  timeoutMs?: number
}

/**
 * Configures the Google Business Profile Cloud Pub/Sub notification setting via the official
 * My Business Notifications API v1 (PATCH accounts/{accountId}/notificationSetting?updateMask=...).
 *
 * Pre-flight safety invariants:
 * - Never sends an empty pubsubTopic or malformed topic resource path.
 * - Never sends an empty notificationTypes array (which would disable merchant notifications).
 * - Always requires NEW_REVIEW and UPDATED_REVIEW when notificationTypes is updated.
 * - Uses the smallest requested updateMask ('pubsubTopic', 'notificationTypes', or both).
 * - Never masks primary 400/401/403/429 responses with deprecated fallbacks.
 */
export async function updateGoogleAccountNotificationSetting(
  accessToken: string,
  accountName: string,
  pubsubTopic: string,
  notificationTypes: string[] = ['NEW_REVIEW', 'UPDATED_REVIEW'],
  options?: UpdateNotificationSettingOptions
): Promise<GoogleNotificationSettingResult> {
  const normalizedAccount = normalizeNotificationAccountPath(accountName)
  if (!normalizedAccount) {
    return {
      success: false,
      httpStatus: 400,
      errorCode: 'INVALID_ACCOUNT_ID',
      error: 'Invalid Google Business Profile account identifier.',
      endpointUsed: 'mybusinessnotifications_v1',
    }
  }

  const maskFields: NotificationUpdateMaskField[] =
    options?.updateMask && options.updateMask.length > 0
      ? Array.from(new Set(options.updateMask))
      : ['pubsubTopic', 'notificationTypes']

  const updateTopic = maskFields.includes('pubsubTopic')
  const updateTypes = maskFields.includes('notificationTypes')

  const cleanTopic = (pubsubTopic || '').trim()
  if (updateTopic && (!cleanTopic || !VALID_GBP_PUBSUB_TOPIC_REGEX.test(cleanTopic))) {
    return {
      success: false,
      httpStatus: 400,
      errorCode: 'INVALID_PUBSUB_TOPIC',
      error: 'Refused PATCH: pubsubTopic must be a valid non-empty Google Cloud Pub/Sub topic resource name.',
      endpointUsed: 'mybusinessnotifications_v1',
    }
  }

  const cleanTypes = Array.from(
    new Set(
      (notificationTypes || [])
        .map((t) => (typeof t === 'string' ? t.trim() : ''))
        .filter((t) => t.length > 0 && t !== 'NOTIFICATION_TYPE_UNSPECIFIED')
    )
  )

  if (updateTypes) {
    if (
      cleanTypes.length === 0 ||
      !cleanTypes.includes('NEW_REVIEW') ||
      !cleanTypes.includes('UPDATED_REVIEW')
    ) {
      return {
        success: false,
        httpStatus: 400,
        errorCode: 'INVALID_NOTIFICATION_TYPES',
        error: 'Refused PATCH: notificationTypes must be non-empty and include both NEW_REVIEW and UPDATED_REVIEW.',
        endpointUsed: 'mybusinessnotifications_v1',
      }
    }
  }

  const resourceName = `${normalizedAccount}/notificationSetting`
  const requestBody: GoogleNotificationSetting = { name: resourceName }
  if (updateTopic) {
    requestBody.pubsubTopic = cleanTopic
  }
  if (updateTypes) {
    requestBody.notificationTypes = cleanTypes
  }

  const updateMaskQuery = maskFields.join(',')
  const timeoutMs = options?.timeoutMs ?? 15_000

  try {
    const notifyUrl = `https://mybusinessnotifications.googleapis.com/v1/${resourceName}?updateMask=${encodeURIComponent(updateMaskQuery)}`
    const res = await fetchWithTimeout(
      notifyUrl,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(requestBody),
      },
      timeoutMs
    )

    if (res.ok) {
      const data = (await res.json()) as GoogleNotificationSetting
      return {
        success: true,
        setting: data,
        httpStatus: res.status,
        endpointUsed: 'mybusinessnotifications_v1',
      }
    }

    const rawText = await res.text()
    const parsed = parseGoogleErrorResponse(rawText, res.status)
    return {
      success: false,
      httpStatus: res.status,
      errorCode: parsed.errorCode,
      error: parsed.message,
      endpointUsed: 'mybusinessnotifications_v1',
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error updating notification setting'
    return {
      success: false,
      httpStatus: 503,
      errorCode: 'NETWORK_ERROR',
      error: msg,
      endpointUsed: 'mybusinessnotifications_v1',
    }
  }
}


