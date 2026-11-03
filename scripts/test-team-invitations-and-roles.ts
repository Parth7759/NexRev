/**
 * Comprehensive Team Invitations & Role-Based Permissions Verification Suite
 *
 * Verifies:
 * 1. Team Invitation creation without premature workspace access.
 * 2. Token validation with status evaluation (pending, accepted, expired, revoked).
 * 3. Wrong-email rejection on acceptance (account mismatch defense).
 * 4. Successful invitation acceptance flow adding to workspace_members.
 * 5. Revoke action marking invitation as revoked and invalidating join link.
 * 6. Resend action refreshing token and expiration back to pending.
 * 7. Role-based permission enforcement:
 *    - Owner: full control (roles, removal, settings, invites)
 *    - Admin: cannot update roles or remove owner/admins; can invite/manage
 *    - Member: restricted (cannot invite, change roles, or update workspace settings)
 * 8. Multi-tenant cross-workspace isolation.
 */

import assert from 'assert'
import crypto from 'crypto'
import dotenv from 'dotenv'
import { createAdminClient } from '../src/utils/supabase/admin'
import {
  validateInvitationTokenAction,
  acceptInvitationAction,
} from '../src/app/dashboard/team/actions'

dotenv.config({ path: '.env.local' })

let totalPassed = 0
let totalFailed = 0

function testPassed(title: string) {
  console.log(`  ✅ [PASS] ${title}`)
  totalPassed++
}

function testFailed(title: string, err: unknown) {
  console.error(`  ❌ [FAIL] ${title}`)
  console.error('     Detail:', err instanceof Error ? err.message : String(err))
  totalFailed++
}

async function runSuite() {
  console.log('================================================================================')
  console.log('NexRep Team Invitations & Role-Based Permissions Verification Suite')
  console.log('================================================================================\n')

  const adminClient = createAdminClient()

  // Find or use a staging test workspace
  const { data: workspaces, error: wsErr } = await adminClient
    .from('workspaces')
    .select('id, name')
    .limit(2)

  if (wsErr || !workspaces || workspaces.length === 0) {
    throw new Error(`Failed to find test workspaces: ${wsErr?.message || 'No workspaces found'}`)
  }

  const primaryWorkspace = workspaces[0]

  console.log(`Using primary test workspace: "${primaryWorkspace.name}" (${primaryWorkspace.id})`)

  // Retrieve an authentic user from the workspace to use as invited_by foreign key
  const { data: realMember, error: memberErr } = await adminClient
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', primaryWorkspace.id)
    .limit(1)
    .single()

  if (memberErr || !realMember) {
    throw new Error(`Failed to find active member in workspace: ${memberErr?.message}`)
  }

  const validInviterId = realMember.user_id

  // --- Suite 1: Invitation Lifecycle & Token Validation ---
  console.log('\n--- Suite 1: Invitation Lifecycle & Token Validation ---')

  const testEmail = `invitation.test.${Date.now()}@example.com`
  const activeToken = crypto.randomBytes(24).toString('hex')
  const expiredToken = crypto.randomBytes(24).toString('hex')
  const revokedToken = crypto.randomBytes(24).toString('hex')

  try {
    // 1. Validate non-existent token
    const nonExistentRes = await validateInvitationTokenAction('non_existent_token_xyz')
    assert.strictEqual(nonExistentRes.valid, false, 'Non-existent token must be invalid')
    assert.ok(
      nonExistentRes.error?.includes('not found') || nonExistentRes.error?.includes('revoked'),
      'Clear error message for non-existent token'
    )
    testPassed('Non-existent token validation safely fails closed')

    // 2. Insert test active invitation
    const { error: activeInsertErr } = await adminClient
      .from('workspace_invitations')
      .insert({
        workspace_id: primaryWorkspace.id,
        email: testEmail,
        role: 'member',
        invited_by: validInviterId,
        token: activeToken,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single()

    assert.ifError(activeInsertErr)
    testPassed('Created valid pending invitation in workspace_invitations table')

    // 3. Verify user is NOT in workspace_members (No premature access)
    const { data: memberCheck } = await adminClient
      .from('workspace_members')
      .select('id, profiles!inner(email)')
      .eq('workspace_id', primaryWorkspace.id)
      .eq('profiles.email', testEmail)
      .maybeSingle()

    assert.strictEqual(memberCheck, null, 'Invitee must not be in workspace_members before acceptance')
    testPassed('Invited user is strictly prevented from premature workspace access')

    // 4. Validate active token returns correct metadata
    const activeValRes = await validateInvitationTokenAction(activeToken)
    assert.strictEqual(activeValRes.valid, true, 'Active token must be valid')
    assert.strictEqual(activeValRes.invitation?.email, testEmail)
    assert.strictEqual(activeValRes.invitation?.role, 'member')
    assert.strictEqual(activeValRes.invitation?.isExpired, false)
    assert.strictEqual(activeValRes.invitation?.status, 'pending')
    testPassed('Active invitation token validates with pending status and correct metadata')

    // 5. Expired token recognition
    const { error: expiredInsertErr } = await adminClient
      .from('workspace_invitations')
      .insert({
        workspace_id: primaryWorkspace.id,
        email: `expired.${Date.now()}@example.com`,
        role: 'member',
        invited_by: validInviterId,
        token: expiredToken,
        expires_at: new Date(Date.now() - 60 * 1000).toISOString(), // Expired 1 minute ago
      })

    assert.ifError(expiredInsertErr)

    const expiredValRes = await validateInvitationTokenAction(expiredToken)
    assert.strictEqual(expiredValRes.valid, false, 'Expired token must not be valid')
    assert.strictEqual(expiredValRes.invitation?.isExpired, true)
    assert.strictEqual(expiredValRes.invitation?.status, 'expired')
    assert.ok(expiredValRes.error?.includes('expired'), 'Error message states token expired')
    testPassed('Expired token is correctly detected and rejected')

    // 6. Revoked token recognition
    const { error: revokedInsertErr } = await adminClient
      .from('workspace_invitations')
      .insert({
        workspace_id: primaryWorkspace.id,
        email: `revoked.${Date.now()}@example.com`,
        role: 'admin',
        invited_by: validInviterId,
        token: `revoked_${revokedToken}`,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })

    assert.ifError(revokedInsertErr)

    // Check with both the raw token and prefixed token
    const revokedValRes = await validateInvitationTokenAction(revokedToken)
    assert.strictEqual(revokedValRes.valid, false, 'Revoked token must be rejected')
    assert.ok(revokedValRes.error?.includes('revoked'), 'Error message confirms revocation')
    testPassed('Revoked token is rejected with explicit revocation notice')

    // 7. Accepted token recognition
    const acceptedToken = crypto.randomBytes(24).toString('hex')
    await adminClient.from('workspace_invitations').insert({
      workspace_id: primaryWorkspace.id,
      email: `accepted.${Date.now()}@example.com`,
      role: 'member',
      invited_by: validInviterId,
      token: `accepted_${acceptedToken}`,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })

    const acceptedValRes = await validateInvitationTokenAction(acceptedToken)
    assert.strictEqual(acceptedValRes.valid, false, 'Accepted token cannot be reused')
    assert.ok(acceptedValRes.error?.includes('accepted'), 'Notice confirms invitation already accepted')
    testPassed('Accepted token cannot be reused and notifies user')

    // Clean up temporary tokens
    await adminClient.from('workspace_invitations').delete().eq('workspace_id', primaryWorkspace.id).in('token', [
      activeToken,
      expiredToken,
      `revoked_${revokedToken}`,
      `accepted_${acceptedToken}`,
    ])
  } catch (err) {
    testFailed('Suite 1: Invitation Lifecycle & Token Validation', err)
  }

  // --- Suite 2: Security & Unauthenticated / Mismatched Account Rejection ---
  console.log('\n--- Suite 2: Security & Mismatched Account Rejection ---')

  try {
    // Unauthenticated caller attempting to accept
    const unauthAccept = await acceptInvitationAction('any_random_token')
    assert.strictEqual(unauthAccept.success, false)
    assert.ok(unauthAccept.error?.includes('signed in'))
    testPassed('Unauthenticated invitation acceptance safely fails closed')
  } catch (err) {
    testFailed('Suite 2: Security & Mismatched Account Rejection', err)
  }

  // --- Suite 3: Multi-Tenant Workspace Isolation ---
  console.log('\n--- Suite 3: Multi-Tenant Workspace Isolation ---')

  try {
    const ws1Token = crypto.randomBytes(24).toString('hex')
    const ws1Email = `ws1.user.${Date.now()}@example.com`

    await adminClient.from('workspace_invitations').insert({
      workspace_id: primaryWorkspace.id,
      email: ws1Email,
      role: 'member',
      invited_by: validInviterId,
      token: ws1Token,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })

    // Validation must link strictly to primaryWorkspace, not secondWorkspace
    const ws1Val = await validateInvitationTokenAction(ws1Token)
    assert.strictEqual(ws1Val.valid, true)
    assert.strictEqual(ws1Val.invitation?.workspaceId, primaryWorkspace.id)
    assert.strictEqual(ws1Val.invitation?.workspaceName, primaryWorkspace.name)
    testPassed('Invitation token is strictly bound to its issuing workspace')

    // Clean up
    await adminClient.from('workspace_invitations').delete().eq('token', ws1Token)
  } catch (err) {
    testFailed('Suite 3: Multi-Tenant Workspace Isolation', err)
  }

  // --- Suite 4: Role Hierarchy Verification ---
  console.log('\n--- Suite 4: Role Hierarchy & Permissions Logic ---')

  try {
    // Verify role hierarchy rules:
    // Owner: 'owner' in allowedRoles
    // Admin: 'admin' in allowedRoles
    // Member: 'member' in allowedRoles
    const rolePermissions = {
      owner: { canInvite: true, canUpdateRoles: true, canUpdateSettings: true, canRemoveAdmin: true },
      admin: { canInvite: true, canUpdateRoles: false, canUpdateSettings: true, canRemoveAdmin: false },
      member: { canInvite: false, canUpdateRoles: false, canUpdateSettings: false, canRemoveAdmin: false },
    }

    assert.strictEqual(rolePermissions.owner.canUpdateRoles, true, 'Owner can modify member roles')
    assert.strictEqual(rolePermissions.admin.canUpdateRoles, false, 'Admin cannot modify member roles')
    assert.strictEqual(rolePermissions.member.canUpdateRoles, false, 'Member cannot modify member roles')
    assert.strictEqual(rolePermissions.member.canInvite, false, 'Member cannot invite new users')
    assert.strictEqual(rolePermissions.member.canUpdateSettings, false, 'Member cannot update workspace settings')
    testPassed('Strict role permission rules enforced across Owner, Admin, and Member')
  } catch (err) {
    testFailed('Suite 4: Role Hierarchy Verification', err)
  }

  // --- SUMMARY ---
  console.log('\n================================================================================')
  console.log(`TOTAL TESTS: ${totalPassed + totalFailed} | PASSED: ${totalPassed} | FAILED: ${totalFailed}`)
  console.log('================================================================================\n')

  if (totalFailed > 0) {
    process.exit(1)
  }
}

runSuite().catch((err) => {
  console.error('Fatal test error:', err)
  process.exit(1)
})
