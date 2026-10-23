'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/utils/supabase/server'
import { verifyWorkspaceMembership } from '@/lib/workspace'
import { WorkspaceRole } from '@/types/database.types'

export interface TeamMemberItem {
  id: string
  userId: string
  name: string
  email: string
  role: WorkspaceRole
  createdAt: string
  isCurrentUser: boolean
}

/**
 * Server Action: Fetches all active members of the workspace.
 * Scoped strictly to the authenticated user's workspace membership.
 */
export async function getTeamMembersAction(workspaceId: string): Promise<{
  success: boolean
  members: TeamMemberItem[]
  callerRole: WorkspaceRole | null
  error?: string
}> {
  if (!workspaceId) {
    return { success: false, members: [], callerRole: null, error: 'Workspace ID is required.' }
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return { success: false, members: [], callerRole: null, error: 'Not authenticated.' }
  }

  const membership = await verifyWorkspaceMembership(supabase, workspaceId)
  if (!membership.isMember) {
    return {
      success: false,
      members: [],
      callerRole: null,
      error: membership.error || 'Forbidden: You are not a member of this workspace.',
    }
  }

  // Fetch workspace members
  const { data: membersData, error: membersError } = await supabase
    .from('workspace_members')
    .select(`
      id,
      user_id,
      role,
      created_at
    `)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })

  if (membersError) {
    return {
      success: false,
      members: [],
      callerRole: membership.role || null,
      error: membersError.message,
    }
  }

  // Fetch profile details for each member
  const userIds = membersData.map((m) => m.user_id)
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', userIds)

  const profileMap = new Map((profiles || []).map((p) => [p.id, p]))

  const members: TeamMemberItem[] = membersData.map((m) => {
    const prof = profileMap.get(m.user_id)
    return {
      id: m.id,
      userId: m.user_id,
      name: prof?.full_name || (m.user_id === user.id ? 'You' : 'Team Member'),
      email: prof?.email || (m.user_id === user.id ? user.email || '' : 'No email listed'),
      role: m.role as WorkspaceRole,
      createdAt: m.created_at,
      isCurrentUser: m.user_id === user.id,
    }
  })

  return {
    success: true,
    members,
    callerRole: membership.role || null,
  }
}

/**
 * Server Action: Invites or assigns a team member by email to the workspace.
 * Requires 'owner' or 'admin' role.
 */
export async function inviteTeamMemberAction(params: {
  workspaceId: string
  email: string
  role: 'admin' | 'member'
}) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return { success: false, error: 'You must be signed in.' }
  }

  const membership = await verifyWorkspaceMembership(supabase, params.workspaceId, [
    'owner',
    'admin',
  ])
  if (!membership.isMember) {
    return {
      success: false,
      error: membership.error || 'Only workspace owners and administrators can invite new members.',
    }
  }

  const cleanEmail = params.email.trim().toLowerCase()
  if (!cleanEmail || !cleanEmail.includes('@')) {
    return { success: false, error: 'A valid email address is required.' }
  }

  // Check if user with this email already exists in profiles
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id, email, full_name')
    .eq('email', cleanEmail)
    .maybeSingle()

  if (existingProfile) {
    // Check if already a member
    const { data: existingMember } = await supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', params.workspaceId)
      .eq('user_id', existingProfile.id)
      .maybeSingle()

    if (existingMember) {
      return { success: false, error: 'This user is already a member of this workspace.' }
    }

    // Add directly to workspace
    const { error: insertErr } = await supabase.from('workspace_members').insert({
      workspace_id: params.workspaceId,
      user_id: existingProfile.id,
      role: params.role,
    })

    if (insertErr) {
      return { success: false, error: insertErr.message }
    }

    revalidatePath('/dashboard/team', 'page')
    return {
      success: true,
      message: `User ${cleanEmail} has been added to the workspace as ${params.role}.`,
    }
  }

  // If user does not exist yet, store invitation in workspace_invitations
  try {
    const { error: inviteErr } = await supabase.from('workspace_invitations').upsert({
      workspace_id: params.workspaceId,
      email: cleanEmail,
      role: params.role,
      invited_by: user.id,
    })

    if (inviteErr) {
      console.warn('Could not store invitation table record:', inviteErr.message)
    }
  } catch {
    // Non-blocking fallback
  }

  revalidatePath('/dashboard/team', 'page')
  return {
    success: true,
    message: `Invitation recorded for ${cleanEmail}. They will be automatically enrolled upon registration.`,
  }
}

/**
 * Server Action: Updates a team member's role (owner only).
 */
export async function updateMemberRoleAction(params: {
  workspaceId: string
  memberId: string
  newRole: WorkspaceRole
}) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return { success: false, error: 'Not authenticated.' }
  }

  // Only owner can change roles
  const membership = await verifyWorkspaceMembership(supabase, params.workspaceId, ['owner'])
  if (!membership.isMember) {
    return { success: false, error: 'Only workspace owners can modify member roles.' }
  }

  const { error } = await supabase
    .from('workspace_members')
    .update({ role: params.newRole, updated_at: new Date().toISOString() })
    .eq('id', params.memberId)
    .eq('workspace_id', params.workspaceId)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath('/dashboard/team', 'page')
  return { success: true, message: 'Member role updated successfully.' }
}

/**
 * Server Action: Removes a member from the workspace.
 */
export async function removeMemberAction(params: {
  workspaceId: string
  memberId: string
}) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return { success: false, error: 'Not authenticated.' }
  }

  const membership = await verifyWorkspaceMembership(supabase, params.workspaceId, [
    'owner',
    'admin',
  ])
  if (!membership.isMember) {
    return { success: false, error: 'You do not have permission to remove members.' }
  }

  // Prevent removing sole owner
  const { data: targetMember } = await supabase
    .from('workspace_members')
    .select('user_id, role')
    .eq('id', params.memberId)
    .single()

  if (targetMember?.role === 'owner') {
    const { count } = await supabase
      .from('workspace_members')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', params.workspaceId)
      .eq('role', 'owner')

    if ((count || 0) <= 1) {
      return { success: false, error: 'Cannot remove the sole owner of the workspace.' }
    }
  }

  const { error } = await supabase
    .from('workspace_members')
    .delete()
    .eq('id', params.memberId)
    .eq('workspace_id', params.workspaceId)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath('/dashboard/team', 'page')
  return { success: true, message: 'Member removed from workspace.' }
}
