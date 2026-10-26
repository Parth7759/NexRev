'use server'

import crypto from 'crypto'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
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

export interface PendingInvitationItem {
  id: string
  workspaceId: string
  email: string
  role: 'admin' | 'member'
  token: string
  expiresAt: string
  createdAt: string
  isExpired: boolean
  inviteLink?: string
}

async function getOrigin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.trim().replace(/\/$/, '')
  }
  try {
    const headerList = await headers()
    const host = headerList.get('host') || 'localhost:3001'
    if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
      return `http://${host}`
    }
    const protocol = headerList.get('x-forwarded-proto') || 'https'
    return `${protocol}://${host}`
  } catch {
    return 'http://localhost:3001'
  }
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
 * Server Action: Fetches pending and active invitations for the workspace.
 * Requires workspace membership.
 */
export async function getPendingInvitationsAction(workspaceId: string): Promise<{
  success: boolean
  invitations: PendingInvitationItem[]
  error?: string
}> {
  if (!workspaceId) {
    return { success: false, invitations: [], error: 'Workspace ID is required.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, invitations: [], error: 'Not authenticated.' }
  }

  const membership = await verifyWorkspaceMembership(supabase, workspaceId, ['owner', 'admin'])
  if (!membership.isMember) {
    return { success: false, invitations: [], error: 'Only owners and admins can view invitations.' }
  }

  const origin = await getOrigin()

  const { data, error } = await supabase
    .from('workspace_invitations')
    .select('id, workspace_id, email, role, token, expires_at, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  if (error) {
    return { success: false, invitations: [], error: error.message }
  }

  const now = new Date()
  const invitations: PendingInvitationItem[] = (data || []).map((inv) => ({
    id: inv.id,
    workspaceId: inv.workspace_id,
    email: inv.email,
    role: inv.role as 'admin' | 'member',
    token: inv.token,
    expiresAt: inv.expires_at,
    createdAt: inv.created_at,
    isExpired: new Date(inv.expires_at) < now,
    inviteLink: `${origin}/invite/${inv.token}`,
  }))

  return { success: true, invitations }
}

/**
 * Server Action: Invites or assigns a team member by email to the workspace.
 * Requires 'owner' or 'admin' role.
 * Accurately reports email provider status and provides an instant shareable link.
 */
export async function inviteTeamMemberAction(params: {
  workspaceId: string
  email: string
  role: 'admin' | 'member'
}): Promise<{
  success: boolean
  message?: string
  error?: string
  inviteLink?: string
  token?: string
  emailSent?: boolean
}> {
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
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!cleanEmail || !emailRegex.test(cleanEmail)) {
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
      message: `User ${cleanEmail} has been added directly to the workspace as ${params.role}.`,
    }
  }

  // Generate secure token and 7-day expiration for new invitation
  const token = crypto.randomBytes(24).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const origin = await getOrigin()
  const inviteLink = `${origin}/invite/${token}`

  // Upsert into workspace_invitations
  const { error: inviteErr } = await supabase.from('workspace_invitations').upsert(
    {
      workspace_id: params.workspaceId,
      email: cleanEmail,
      role: params.role,
      invited_by: user.id,
      token,
      expires_at: expiresAt,
    },
    { onConflict: 'workspace_id,email' }
  )

  if (inviteErr) {
    return {
      success: false,
      error: `Failed to create invitation record: ${inviteErr.message}`,
    }
  }

  revalidatePath('/dashboard/team', 'page')

  return {
    success: true,
    message: `Invitation created for ${cleanEmail}. Email delivery is not configured, so share the link directly.`,
    inviteLink,
    token,
    emailSent: false,
  }
}

/**
 * Server Action: Revokes / cancels a pending invitation.
 */
export async function revokeInvitationAction(params: {
  workspaceId: string
  invitationId: string
}): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const membership = await verifyWorkspaceMembership(supabase, params.workspaceId, ['owner', 'admin'])
  if (!membership.isMember) {
    return { success: false, error: 'Only owners and administrators can revoke invitations.' }
  }

  const { error } = await supabase
    .from('workspace_invitations')
    .delete()
    .eq('id', params.invitationId)
    .eq('workspace_id', params.workspaceId)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath('/dashboard/team', 'page')
  return { success: true }
}

/**
 * Server Action: Validates an invitation token (safe public check for invite acceptance page).
 */
export async function validateInvitationTokenAction(token: string): Promise<{
  valid: boolean
  error?: string
  invitation?: {
    email: string
    role: 'admin' | 'member'
    workspaceName: string
    workspaceId: string
    expiresAt: string
    isExpired: boolean
  }
}> {
  if (!token || token.trim() === '') {
    return { valid: false, error: 'Missing invitation token.' }
  }

  const adminClient = createAdminClient()

  const { data: inv, error } = await adminClient
    .from('workspace_invitations')
    .select(`
      id,
      workspace_id,
      email,
      role,
      token,
      expires_at,
      workspaces:workspace_id (
        name
      )
    `)
    .eq('token', token.trim())
    .maybeSingle()

  if (error || !inv) {
    return { valid: false, error: 'Invitation not found or has been revoked.' }
  }

  const isExpired = new Date(inv.expires_at) < new Date()
  if (isExpired) {
    return {
      valid: false,
      error: 'This invitation has expired. Please request a new invite from your workspace admin.',
      invitation: {
        email: inv.email,
        role: inv.role as 'admin' | 'member',
        workspaceName: (inv.workspaces as unknown as { name?: string })?.name || 'Workspace',
        workspaceId: inv.workspace_id,
        expiresAt: inv.expires_at,
        isExpired: true,
      },
    }
  }

  return {
    valid: true,
    invitation: {
      email: inv.email,
      role: inv.role as 'admin' | 'member',
      workspaceName: (inv.workspaces as unknown as { name?: string })?.name || 'Workspace',
      workspaceId: inv.workspace_id,
      expiresAt: inv.expires_at,
      isExpired: false,
    },
  }
}

/**
 * Server Action: Accepts an invitation using a validated token.
 * Authenticated user joins the workspace with the invited role.
 */
export async function acceptInvitationAction(token: string): Promise<{
  success: boolean
  error?: string
  workspaceId?: string
  workspaceName?: string
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: 'You must be signed in to accept an invitation.' }
  }

  const adminClient = createAdminClient()

  // 1. Look up invitation
  const { data: inv, error: findErr } = await adminClient
    .from('workspace_invitations')
    .select(`
      id,
      workspace_id,
      email,
      role,
      expires_at,
      workspaces:workspace_id (
        name
      )
    `)
    .eq('token', token.trim())
    .maybeSingle()

  if (findErr || !inv) {
    return { success: false, error: 'Invalid invitation token.' }
  }

  if (new Date(inv.expires_at) < new Date()) {
    return { success: false, error: 'This invitation has expired.' }
  }

  // 2. Security Check: Authenticated user's server-verified email MUST match the invitation email
  const authenticatedEmail = user.email?.trim().toLowerCase()
  const invitedEmail = inv.email?.trim().toLowerCase()

  if (!authenticatedEmail || authenticatedEmail !== invitedEmail) {
    return {
      success: false,
      error: `This invitation was issued to ${inv.email}. You are currently signed in as ${user.email || 'a different account'}. Please sign in with ${inv.email} to join.`,
    }
  }

  const workspaceName = (inv.workspaces as unknown as { name?: string })?.name || 'Workspace'

  // 3. Check if already a member
  const { data: existingMember } = await adminClient
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', inv.workspace_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (existingMember) {
    // Clean up invitation if redundant
    await adminClient.from('workspace_invitations').delete().eq('id', inv.id)
    return {
      success: true,
      workspaceId: inv.workspace_id,
      workspaceName,
    }
  }

  // 3. Add to workspace_members
  const { error: joinErr } = await adminClient.from('workspace_members').insert({
    workspace_id: inv.workspace_id,
    user_id: user.id,
    role: inv.role,
  })

  if (joinErr) {
    return { success: false, error: `Failed to join workspace: ${joinErr.message}` }
  }

  // 4. Delete the accepted invitation
  await adminClient.from('workspace_invitations').delete().eq('id', inv.id)

  revalidatePath('/dashboard', 'layout')
  revalidatePath('/dashboard/team', 'page')

  return {
    success: true,
    workspaceId: inv.workspace_id,
    workspaceName,
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
