'use server'

import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'

export interface PlatformStats {
  totalWorkspaces: number
  totalUsers: number
  connectedLocations: number
  totalReviews: number
  totalReplies: number
  workspaces: Array<{
    id: string
    name: string
    createdAt: string
    ownerEmail: string
    connectedLocationsCount: number
  }>
  systemHealth: {
    status: 'healthy' | 'degraded'
    cronConfigured: boolean
    aiConfigured: boolean
    googleOAuthConfigured: boolean
  }
}

export async function checkSuperAdminStatusAction(): Promise<{
  isAuthorized: boolean
  userEmail: string | null
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || !user.email) {
    return { isAuthorized: false, userEmail: null }
  }

  const superAdminEmails = (process.env.SUPER_ADMIN_EMAILS || 'admin@nexrep.com')
    .split(',')
    .map((e) => e.trim().toLowerCase())

  const isSuperAdmin =
    user.app_metadata?.role === 'superadmin' ||
    superAdminEmails.includes(user.email.toLowerCase())

  return { isAuthorized: isSuperAdmin, userEmail: user.email }
}

export async function getSuperAdminPlatformDataAction(): Promise<{
  isAuthorized: boolean
  userEmail: string | null
  error?: string
  data?: PlatformStats
}> {
  const { isAuthorized, userEmail } = await checkSuperAdminStatusAction()

  if (!isAuthorized) {
    return {
      isAuthorized: false,
      userEmail,
      error: 'Access restricted: Your account does not have platform-wide Super Admin privileges.',
    }
  }

  try {
    const admin = createAdminClient()

    // 1. Fetch real workspace count and records
    const { data: wsData, count: wsCount, error: wsError } = await admin
      .from('workspaces')
      .select('id, name, created_at, created_by', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(20)

    if (wsError) throw wsError

    // 2. Fetch real user count
    const { count: usersCount, error: usersError } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })

    if (usersError) throw usersError

    // 3. Fetch connected locations count
    const { data: locData, count: locCount, error: locError } = await admin
      .from('locations')
      .select('id, workspace_id, is_connected', { count: 'exact' })
      .eq('is_connected', true)

    if (locError) throw locError

    // 4. Fetch total reviews
    const { count: revCount, error: revError } = await admin
      .from('reviews')
      .select('id', { count: 'exact', head: true })

    if (revError) throw revError

    // 5. Fetch total review replies
    const { count: replyCount, error: replyError } = await admin
      .from('review_replies')
      .select('id', { count: 'exact', head: true })

    if (replyError) throw replyError

    // 6. Fetch profiles to resolve owner emails
    const ownerIds = (wsData || []).map((w) => w.created_by).filter(Boolean) as string[]
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, email')
      .in('id', ownerIds)

    const profileMap = new Map((profiles || []).map((p) => [p.id, p.email || 'Unknown']))

    // Map connected locations to workspace IDs
    const connectedByWorkspace = new Map<string, number>()
    for (const loc of locData || []) {
      const current = connectedByWorkspace.get(loc.workspace_id) || 0
      connectedByWorkspace.set(loc.workspace_id, current + 1)
    }

    const workspaces = (wsData || []).map((w) => ({
      id: w.id,
      name: w.name,
      createdAt: w.created_at,
      ownerEmail: w.created_by ? profileMap.get(w.created_by) || 'Workspace Owner' : 'System',
      connectedLocationsCount: connectedByWorkspace.get(w.id) || 0,
    }))

    const aiConfigured = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim() !== '')
    const googleOAuthConfigured = Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    )
    const cronConfigured = Boolean(process.env.CRON_SECRET)

    return {
      isAuthorized: true,
      userEmail,
      data: {
        totalWorkspaces: wsCount || 0,
        totalUsers: usersCount || 0,
        connectedLocations: locCount || 0,
        totalReviews: revCount || 0,
        totalReplies: replyCount || 0,
        workspaces,
        systemHealth: {
          status: 'healthy',
          cronConfigured,
          aiConfigured,
          googleOAuthConfigured,
        },
      },
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to query platform stats.'
    return {
      isAuthorized: true,
      userEmail,
      error: msg,
    }
  }
}
