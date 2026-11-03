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

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked'

export interface PendingInvitationItem {
  id: string
  workspaceId: string
  email: string
  role: 'admin' | 'member'
  token: string
  expiresAt: string
  createdAt: string
  status: InvitationStatus
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
 * Server Action: Fetches all invitations (pending, accepted, expired, revoked) for the workspace.
 * Requires 'owner' or 'admin' role.
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

  // Cross-reference with active members to accurately determine accepted status
  const { data: currentMembers } = await supabase
    .from('workspace_members')
    .select('user_id, profiles(email)')
    .eq('workspace_id', workspaceId)

  const activeMemberEmails = new Set(
    (currentMembers || [])
      .map((m) => (m.profiles as unknown as { email?: string })?.email?.toLowerCase())
      .filter(Boolean)
  )

  const now = new Date()
  const invitations: PendingInvitationItem[] = (data || []).map((inv) => {
    const isRevoked = inv.token.startsWith('revoked_')
    const isAccepted = inv.token.startsWith('accepted_') || activeMemberEmails.has(inv.email.toLowerCase())
    const isExpired = !isAccepted && !isRevoked && new Date(inv.expires_at) < now

    let status: InvitationStatus = 'pending'
    if (isAccepted) {
      status = 'accepted'
    } else if (isRevoked) {
      status = 'revoked'
    } else if (isExpired) {
      status = 'expired'
    }

    const cleanToken = inv.token.replace(/^(revoked_|accepted_)/, '')

    return {
      id: inv.id,
      workspaceId: inv.workspace_id,
      email: inv.email,
      role: inv.role as 'admin' | 'member',
      token: inv.token,
      expiresAt: inv.expires_at,
      createdAt: inv.created_at,
      status,
      isExpired: new Date(inv.expires_at) < now,
      inviteLink: `${origin}/invite/${cleanToken}`,
    }
  })

  return { success: true, invitations }
}

/**
 * Server Action: Invites a team member by email to the workspace.
 * Requires 'owner' or 'admin' role.
 * Generates an expiring invitation link, sends invitation email, and does NOT
 * grant workspace access until the invited person accepts.
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
    return { success: false, error: 'You must be signed in to invite team members.' }
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

  // Check if this user is ALREADY an active member of the workspace
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id, email')
    .eq('email', cleanEmail)
    .maybeSingle()

  if (existingProfile) {
    const { data: existingMember } = await supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', params.workspaceId)
      .eq('user_id', existingProfile.id)
      .maybeSingle()

    if (existingMember) {
      return { success: false, error: 'This user is already an active member of this workspace.' }
    }
  }

  // Generate secure token and 7-day expiration for new invitation
  const token = crypto.randomBytes(24).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const origin = await getOrigin()
  const inviteLink = `${origin}/invite/${token}`

  // Upsert into workspace_invitations (unique on workspace_id, email)
  const adminClient = createAdminClient()
  const { error: inviteErr } = await adminClient.from('workspace_invitations').upsert(
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

  // Attempt to send invitation email via Supabase Auth admin mailer
  let emailSent = false
  try {
    const { error: sendErr } = await adminClient.auth.admin.inviteUserByEmail(cleanEmail, {
      redirectTo: inviteLink,
    })
    if (!sendErr) {
      emailSent = true
    }
  } catch {
    emailSent = false
  }

  revalidatePath('/dashboard/team', 'page')

  return {
    success: true,
    message: emailSent
      ? `Invitation sent via email to ${cleanEmail}.`
      : `Invitation link generated for ${cleanEmail}. Outbound email delivery is not configured, so share the link directly.`,
    inviteLink,
    token,
    emailSent,
  }
}

/**
 * Server Action: Revokes a pending or active invitation.
 * Requires 'owner' or 'admin' role.
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

  const adminClient = createAdminClient()
  const { data: inv, error: findErr } = await adminClient
    .from('workspace_invitations')
    .select('id, token')
    .eq('id', params.invitationId)
    .eq('workspace_id', params.workspaceId)
    .maybeSingle()

  if (findErr || !inv) {
    return { success: false, error: 'Invitation not found.' }
  }

  const targetToken = inv.token.startsWith('revoked_') ? inv.token : `revoked_${inv.token}`
  const { error: updateErr } = await adminClient
    .from('workspace_invitations')
    .update({ token: targetToken })
    .eq('id', params.invitationId)
    .eq('workspace_id', params.workspaceId)

  if (updateErr) {
    return { success: false, error: updateErr.message }
  }

  revalidatePath('/dashboard/team', 'page')
  return { success: true }
}

/**
 * Server Action: Resends an existing invitation with a fresh token and expiration.
 * Requires 'owner' or 'admin' role.
 */
export async function resendInvitationAction(params: {
  workspaceId: string
  invitationId: string
}): Promise<{
  success: boolean
  message?: string
  error?: string
  inviteLink?: string
  emailSent?: boolean
}> {
  const supabase = await createClient()
  const membership = await verifyWorkspaceMembership(supabase, params.workspaceId, ['owner', 'admin'])
  if (!membership.isMember) {
    return { success: false, error: 'Only owners and administrators can resend invitations.' }
  }

  const adminClient = createAdminClient()
  const { data: inv, error: findErr } = await adminClient
    .from('workspace_invitations')
    .select('id, email, role, workspace_id')
    .eq('id', params.invitationId)
    .eq('workspace_id', params.workspaceId)
    .maybeSingle()

  if (findErr || !inv) {
    return { success: false, error: 'Invitation not found.' }
  }

  // Check if this recipient already joined
  const { data: existingProfile } = await adminClient
    .from('profiles')
    .select('id')
    .eq('email', inv.email.toLowerCase())
    .maybeSingle()

  if (existingProfile) {
    const { data: isMember } = await adminClient
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', params.workspaceId)
      .eq('user_id', existingProfile.id)
      .maybeSingle()

    if (isMember) {
      return {
        success: false,
        error: `${inv.email} has already accepted the invitation and is an active member of this workspace.`,
      }
    }
  }

  const newToken = crypto.randomBytes(24).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const origin = await getOrigin()
  const inviteLink = `${origin}/invite/${newToken}`

  const { error: updateErr } = await adminClient
    .from('workspace_invitations')
    .update({
      token: newToken,
      expires_at: expiresAt,
    })
    .eq('id', params.invitationId)
    .eq('workspace_id', params.workspaceId)

  if (updateErr) {
    return { success: false, error: `Failed to refresh invitation: ${updateErr.message}` }
  }

  let emailSent = false
  try {
    const { error: sendErr } = await adminClient.auth.admin.inviteUserByEmail(inv.email, {
      redirectTo: inviteLink,
    })
    if (!sendErr) {
      emailSent = true
    }
  } catch {
    emailSent = false
  }

  revalidatePath('/dashboard/team', 'page')
  return {
    success: true,
    message: emailSent
      ? `Invitation resent via email to ${inv.email}.`
      : `Invitation link refreshed for ${inv.email}. Outbound email is inactive, so copy the link.`,
    inviteLink,
    emailSent,
  }
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
    status: InvitationStatus
  }
}> {
  if (!token || token.trim() === '') {
    return { valid: false, error: 'Missing invitation token.' }
  }

  const trimmedToken = token.trim()
  const adminClient = createAdminClient()

  // 1. Direct token lookup
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
    .eq('token', trimmedToken)
    .maybeSingle()

  // 2. If direct match not found, check if token was revoked or accepted
  if (error || !inv) {
    const { data: revokedInv } = await adminClient
      .from('workspace_invitations')
      .select('id, email, token, expires_at, workspace_id, workspaces:workspace_id (name)')
      .eq('token', `revoked_${trimmedToken}`)
      .maybeSingle()

    if (revokedInv) {
      return {
        valid: false,
        error: 'This invitation has been revoked. Please request a new invite from your workspace administrator.',
      }
    }

    const { data: acceptedInv } = await adminClient
      .from('workspace_invitations')
      .select('id, email, token, expires_at, workspace_id, workspaces:workspace_id (name)')
      .eq('token', `accepted_${trimmedToken}`)
      .maybeSingle()

    if (acceptedInv) {
      return {
        valid: false,
        error: 'This invitation has already been accepted. You can log in directly to access the workspace.',
      }
    }

    return { valid: false, error: 'Invitation not found or has been revoked.' }
  }

  const workspaceName = (inv.workspaces as unknown as { name?: string })?.name || 'Workspace'

  if (inv.token.startsWith('revoked_')) {
    return {
      valid: false,
      error: 'This invitation has been revoked. Please request a new invite from your workspace administrator.',
    }
  }

  if (inv.token.startsWith('accepted_')) {
    return {
      valid: false,
      error: 'This invitation has already been accepted. You can log in directly to access the workspace.',
    }
  }

  const isExpired = new Date(inv.expires_at) < new Date()
  if (isExpired) {
    return {
      valid: false,
      error: 'This invitation has expired. Please request a new invite from your workspace admin.',
      invitation: {
        email: inv.email,
        role: inv.role as 'admin' | 'member',
        workspaceName,
        workspaceId: inv.workspace_id,
        expiresAt: inv.expires_at,
        isExpired: true,
        status: 'expired',
      },
    }
  }

  return {
    valid: true,
    invitation: {
      email: inv.email,
      role: inv.role as 'admin' | 'member',
      workspaceName,
      workspaceId: inv.workspace_id,
      expiresAt: inv.expires_at,
      isExpired: false,
      status: 'pending',
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

  const trimmedToken = token.trim()
  const adminClient = createAdminClient()

  // 1. Look up invitation
  const { data: inv, error: findErr } = await adminClient
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
    .eq('token', trimmedToken)
    .maybeSingle()

  if (findErr || !inv) {
    // Check if already revoked or accepted
    const { data: revokedInv } = await adminClient
      .from('workspace_invitations')
      .select('id')
      .eq('token', `revoked_${trimmedToken}`)
      .maybeSingle()

    if (revokedInv) {
      return { success: false, error: 'This invitation has been revoked.' }
    }

    const { data: acceptedInv } = await adminClient
      .from('workspace_invitations')
      .select('id')
      .eq('token', `accepted_${trimmedToken}`)
      .maybeSingle()

    if (acceptedInv) {
      return { success: false, error: 'This invitation has already been accepted.' }
    }

    return { success: false, error: 'Invalid or expired invitation token.' }
  }

  if (inv.token.startsWith('revoked_')) {
    return { success: false, error: 'This invitation has been revoked.' }
  }

  if (inv.token.startsWith('accepted_')) {
    return { success: false, error: 'This invitation has already been accepted.' }
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

  if (!existingMember) {
    // Add to workspace_members
    const { error: joinErr } = await adminClient.from('workspace_members').insert({
      workspace_id: inv.workspace_id,
      user_id: user.id,
      role: inv.role,
    })

    if (joinErr) {
      return { success: false, error: `Failed to join workspace: ${joinErr.message}` }
    }
  }

  // 4. Update the invitation token to accepted status (preserve record for audit & status display)
  const acceptedToken = inv.token.startsWith('accepted_') ? inv.token : `accepted_${inv.token}`
  await adminClient
    .from('workspace_invitations')
    .update({ token: acceptedToken })
    .eq('id', inv.id)

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
 * Owners can remove any member (except the sole owner).
 * Admins can remove members, but cannot remove owners or other admins.
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

  // Fetch the target member to inspect their role
  const { data: targetMember } = await supabase
    .from('workspace_members')
    .select('user_id, role')
    .eq('id', params.memberId)
    .single()

  if (!targetMember) {
    return { success: false, error: 'Target member not found.' }
  }

  // Admins cannot remove owners or other admins
  if (membership.role === 'admin' && (targetMember.role === 'owner' || targetMember.role === 'admin')) {
    return { success: false, error: 'Administrators cannot remove other administrators or workspace owners.' }
  }

  // Prevent removing sole owner
  if (targetMember.role === 'owner') {
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
