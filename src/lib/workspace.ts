import { SupabaseClient } from '@supabase/supabase-js'
import { Database, WorkspaceRole, ReviewStatus } from '@/types/database.types'

export type TypedSupabaseClient = SupabaseClient<Database>

export interface WorkspaceMembershipValidation {
  isMember: boolean
  role?: WorkspaceRole
  userId?: string
  workspaceId?: string
  error?: string
}

/**
 * Server-side verification of workspace membership.
 * NEVER trust a workspace ID supplied by the browser without running this verification.
 */
export async function verifyWorkspaceMembership(
  supabase: TypedSupabaseClient,
  workspaceId: string,
  requiredRoles?: WorkspaceRole[]
): Promise<WorkspaceMembershipValidation> {
  if (!workspaceId) {
    return { isMember: false, error: 'Workspace ID is required' }
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { isMember: false, error: 'Unauthorized: User is not authenticated' }
  }

  // Verify membership directly in public.workspace_members
  const { data, error: membershipError } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle()

  const membership = data as { role: WorkspaceRole } | null

  if (membershipError || !membership) {
    return {
      isMember: false,
      userId: user.id,
      workspaceId,
      error: 'Forbidden: You are not a member of this workspace',
    }
  }

  const userRole = membership.role

  if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes(userRole)) {
    return {
      isMember: false,
      role: userRole,
      userId: user.id,
      workspaceId,
      error: `Forbidden: Requires one of [${requiredRoles.join(', ')}] role`,
    }
  }

  return {
    isMember: true,
    role: userRole,
    userId: user.id,
    workspaceId,
  }
}

/**
 * Fetches all workspaces the authenticated user belongs to.
 */
export async function getUserWorkspaces(supabase: TypedSupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from('workspace_members')
    .select(`
      role,
      workspaces (
        id,
        name,
        slug,
        created_at,
        updated_at
      )
    `)
    .eq('user_id', userId)

  if (error) {
    throw new Error(`Failed to fetch workspaces: ${error.message}`)
  }

  return data
}

/**
 * Retrieves the default or active workspace for a user.
 */
export async function getDefaultWorkspace(supabase: TypedSupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from('workspace_members')
    .select(`
      role,
      workspaces (
        id,
        name,
        slug,
        created_at
      )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to fetch default workspace: ${error.message}`)
  }

  return data
}

/**
 * Safe server query for workspace locations with verified membership.
 */
export async function getVerifiedLocations(supabase: TypedSupabaseClient, workspaceId: string) {
  const authCheck = await verifyWorkspaceMembership(supabase, workspaceId)
  if (!authCheck.isMember) {
    throw new Error(authCheck.error || 'Unauthorized workspace access')
  }

  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return data
}

/**
 * Safe server query for workspace reviews with verified membership.
 */
export async function getVerifiedReviews(
  supabase: TypedSupabaseClient,
  workspaceId: string,
  options?: { status?: ReviewStatus; limit?: number; locationId?: string }
) {
  const authCheck = await verifyWorkspaceMembership(supabase, workspaceId)
  if (!authCheck.isMember) {
    throw new Error(authCheck.error || 'Unauthorized workspace access')
  }

  let query = supabase
    .from('reviews')
    .select(`
      *,
      locations (id, name, address),
      review_replies (*)
    `)
    .eq('workspace_id', workspaceId)
    .order('review_date', { ascending: false })

  if (options?.locationId && options.locationId !== 'all') {
    query = query.eq('location_id', options.locationId)
  }
  if (options?.status) {
    query = query.eq('status', options.status)
  }
  if (options?.limit) {
    query = query.limit(options.limit)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data
}

/**
 * Safe server query for workspace team members with verified membership.
 */
export async function getVerifiedMembers(supabase: TypedSupabaseClient, workspaceId: string) {
  const authCheck = await verifyWorkspaceMembership(supabase, workspaceId)
  if (!authCheck.isMember) {
    throw new Error(authCheck.error || 'Unauthorized workspace access')
  }

  const { data, error } = await supabase
    .from('workspace_members')
    .select(`
      id,
      role,
      created_at,
      profiles (
        id,
        email,
        full_name,
        avatar_url
      )
    `)
    .eq('workspace_id', workspaceId)

  if (error) throw new Error(error.message)
  return data
}
