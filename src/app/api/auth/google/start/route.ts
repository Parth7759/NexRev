import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createClient } from '@/utils/supabase/server'
import { verifyWorkspaceMembership } from '@/lib/workspace'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const host = request.headers.get('host') || 'localhost:3001'
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '') ||
    (host.startsWith('localhost')
      ? `http://${host}`
      : `${request.headers.get('x-forwarded-proto') || 'https'}://${host}`)

  // 1. Verify user authentication
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent('Please sign in before connecting Google Business Profile.')}`
    )
  }

  // 2. Identify target workspace
  let workspaceId = requestUrl.searchParams.get('workspaceId')

  if (!workspaceId) {
    const cookieWsId = request.cookies.get('nexrep_active_workspace_id')?.value
    if (cookieWsId) {
      workspaceId = cookieWsId
    }
  }

  if (!workspaceId) {
    // Fall back to user's first workspace membership
    const { data: member } = await supabase
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle()

    if (member?.workspace_id) {
      workspaceId = member.workspace_id
    }
  }

  if (!workspaceId) {
    // Auto-onboarding fallback: if authenticated user has no workspace, provision initial owner workspace
    const userName =
      (user.user_metadata?.full_name as string) ||
      user.email?.split('@')[0] ||
      'My Business'
    const defaultWsName = `${userName}'s Workspace`
    const slug = defaultWsName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')

    const { data: newWs } = await supabase
      .from('workspaces')
      .insert({
        name: defaultWsName,
        slug,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (newWs?.id) {
      const { error: memberError } = await supabase
        .from('workspace_members')
        .insert({
          workspace_id: newWs.id,
          user_id: user.id,
          role: 'owner',
        })

      if (!memberError) {
        workspaceId = newWs.id
      }
    }
  }

  if (!workspaceId) {
    return NextResponse.redirect(
      `${origin}/dashboard/locations?google_error=${encodeURIComponent(
        'No active workspace found. Please create or select a workspace first.'
      )}`
    )
  }

  // 3. Verify workspace authorization (owner or admin required)
  const membershipCheck = await verifyWorkspaceMembership(supabase, workspaceId, ['owner', 'admin'])
  if (!membershipCheck.isMember) {
    return NextResponse.redirect(
      `${origin}/dashboard/locations?google_error=${encodeURIComponent(
        membershipCheck.error || 'Only workspace owners and administrators can connect Google Business Profile.'
      )}`
    )
  }

  // 4. Validate server-side Google OAuth credentials
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId || clientId.trim() === '') {
    return NextResponse.redirect(
      `${origin}/dashboard/locations?google_error=${encodeURIComponent(
        'Google OAuth is not configured on the server. Please add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local.'
      )}`
    )
  }

  // Determine redirect URI (server-side only)
  // Prefer explicitly configured GOOGLE_REDIRECT_URI.
  // In development, default to http://localhost:3001/api/auth/google/callback if running locally.
  let redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim()

  if (!redirectUri) {
    if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
      const port = host.split(':')[1] || '3001'
      redirectUri = `http://localhost:${port}/api/auth/google/callback`
    } else {
      redirectUri = `${origin}/api/auth/google/callback`
    }
  }

  // 5. Generate cryptographically random state to prevent CSRF
  const stateToken = crypto.randomBytes(32).toString('hex')
  const stateData = {
    state: stateToken,
    workspaceId,
    userId: user.id,
    redirectUri,
    createdAt: Date.now(),
  }

  // 6. Build Google OAuth authorization URL
  // Scopes: https://www.googleapis.com/auth/business.manage (core required GBP scope) + identity scopes
  const scopes = [
    'https://www.googleapis.com/auth/business.manage',
    'openid',
    'email',
    'profile',
  ].join(' ')

  const params = new URLSearchParams({
    client_id: clientId.trim(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline', // Required to receive a refresh token
    prompt: 'consent',     // Forces consent screen to ensure refresh token issuance
    state: stateToken,
    include_granted_scopes: 'true',
  })

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`

  // 7. Store state in secure HTTP-only cookie and redirect to Google
  const response = NextResponse.redirect(googleAuthUrl)

  response.cookies.set('nexrep_google_oauth_state', JSON.stringify(stateData), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 minutes
  })

  return response
}
