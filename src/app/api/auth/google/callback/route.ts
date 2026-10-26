import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { verifyWorkspaceMembership } from '@/lib/workspace'
import { encryptToken } from '@/lib/encryption'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const host = request.headers.get('host') || 'localhost:3001'
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '') ||
    (host.startsWith('localhost')
      ? `http://${host}`
      : `${request.headers.get('x-forwarded-proto') || 'https'}://${host}`)

  const code = requestUrl.searchParams.get('code')
  const state = requestUrl.searchParams.get('state')
  const error = requestUrl.searchParams.get('error')
  const errorDescription = requestUrl.searchParams.get('error_description')

  // Prepare a redirect response with cookie cleanup
  const createRedirect = (
    path: string,
    queryParam: { key: string; value: string },
    extraParams?: Record<string, string>
  ) => {
    const url = new URL(`${origin}${path}`)
    url.searchParams.set(queryParam.key, queryParam.value)
    if (extraParams) {
      for (const [k, v] of Object.entries(extraParams)) {
        url.searchParams.set(k, v)
      }
    }
    const res = NextResponse.redirect(url.toString())
    res.cookies.delete('nexrep_google_oauth_state')
    return res
  }

  // 1. Handle error directly returned from Google
  if (error || errorDescription) {
    const errorMsg = errorDescription || error || 'Google OAuth authentication was denied or cancelled.'
    return createRedirect('/dashboard/locations', { key: 'google_error', value: errorMsg })
  }

  // 2. Validate state cookie to prevent CSRF
  const stateCookie = request.cookies.get('nexrep_google_oauth_state')?.value
  if (!stateCookie) {
    return createRedirect('/dashboard/locations', {
      key: 'google_error',
      value: 'OAuth session expired or missing state verification. Please initiate connection again.',
    })
  }

  let stateData: { state: string; workspaceId: string; userId: string }
  try {
    stateData = JSON.parse(stateCookie)
  } catch {
    return createRedirect('/dashboard/locations', {
      key: 'google_error',
      value: 'Corrupted OAuth state cookie. Please try again.',
    })
  }

  if (!state || state !== stateData.state) {
    return createRedirect('/dashboard/locations', {
      key: 'google_error',
      value: 'Security validation failed: OAuth state mismatch (possible CSRF attack).',
    })
  }

  if (!code) {
    return createRedirect('/dashboard/locations', {
      key: 'google_error',
      value: 'No authorization code received from Google.',
    })
  }

  // 3. Verify user authentication and workspace authorization
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user || user.id !== stateData.userId) {
    return createRedirect('/login', {
      key: 'error',
      value: 'Authentication mismatch. Please sign in to the authorized account.',
    })
  }

  const membershipCheck = await verifyWorkspaceMembership(supabase, stateData.workspaceId, [
    'owner',
    'admin',
  ])
  if (!membershipCheck.isMember) {
    return createRedirect('/dashboard/locations', {
      key: 'google_error',
      value: membershipCheck.error || 'You do not have permission to configure integrations for this workspace.',
    })
  }

  // 4. Server-side token exchange
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = (
    process.env.GOOGLE_REDIRECT_URI || `${origin}/api/auth/google/callback`
  ).trim()

  if (!clientId || !clientSecret) {
    return createRedirect('/dashboard/locations', {
      key: 'google_error',
      value: 'Google client credentials missing on server. Please configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
    })
  }

  let tokenData: {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
    id_token?: string
    error?: string
    error_description?: string
  }

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId.trim(),
        client_secret: clientSecret.trim(),
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    })

    tokenData = await tokenResponse.json()

    if (!tokenResponse.ok || !tokenData.access_token) {
      const msg = tokenData.error_description || tokenData.error || 'Token exchange failed.'
      return createRedirect('/dashboard/locations', {
        key: 'google_error',
        value: `Google token exchange failed: ${msg}`,
      })
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error during token exchange'
    return createRedirect('/dashboard/locations', {
      key: 'google_error',
      value: `Failed to connect to Google OAuth server: ${msg}`,
    })
  }

  // 5. Query user account info to identify connected profile
  let accountName = 'Connected Google Account'
  let accountId: string | null = null

  try {
    const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    if (userinfoRes.ok) {
      const userinfo = await userinfoRes.json()
      accountName = userinfo.email || userinfo.name || 'Connected Google Account'
      accountId = userinfo.sub || null
    }
  } catch {
    // Non-blocking fallback
  }

  // 6. Encrypt tokens before storing
  const encryptedAccessToken = encryptToken(tokenData.access_token)
  let encryptedRefreshToken: string | null = tokenData.refresh_token
    ? encryptToken(tokenData.refresh_token)
    : null

  // If Google did not return a new refresh token (re-authentication without revoke), keep existing refresh token
  if (!encryptedRefreshToken) {
    const { data: existingIntegration } = await supabase
      .from('google_integrations')
      .select('refresh_token_encrypted')
      .eq('workspace_id', stateData.workspaceId)
      .maybeSingle()

    if (existingIntegration?.refresh_token_encrypted) {
      encryptedRefreshToken = existingIntegration.refresh_token_encrypted
    }
  }

  const expiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString()

  // 7. Store encrypted tokens in public.google_integrations
  const { error: dbError } = await supabase
    .from('google_integrations')
    .upsert(
      {
        workspace_id: stateData.workspaceId,
        connected_by: user.id,
        account_id: accountId,
        account_name: accountName,
        scope: tokenData.scope || 'https://www.googleapis.com/auth/business.manage',
        access_token_encrypted: encryptedAccessToken,
        refresh_token_encrypted: encryptedRefreshToken,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id' }
    )

  if (dbError) {
    return createRedirect('/dashboard/locations', {
      key: 'google_error',
      value: `Failed to save Google integration: ${dbError.message}`,
    })
  }

  // 8. Redirect with success message and trigger business profile selector
  return createRedirect(
    '/dashboard/locations',
    {
      key: 'google_success',
      value: `Successfully authenticated Google account (${accountName}). Please select your business profile below.`,
    },
    { select_profile: '1' }
  )
}
