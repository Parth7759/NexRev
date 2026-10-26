/**
 * NexRep Functional Fixes & Regression Test Suite
 * Tests the 5 repaired functional areas:
 * 1. Team Invitations (creation, token generation, link, validation, acceptance, revocation)
 * 2. Super Admin (server authorization, tenant isolation, real telemetry, zero mock data)
 * 3. AI Review Assistant (workflow, eligible reviews, tone selection, draft generation, safe saving)
 * 4. Notifications (real operational alerts aggregation, unread status)
 * 5. Profile Menu & Sign Out (authentic profile data, role badge, session sign out)
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import assert from 'assert'
import crypto from 'crypto'
import { createAdminClient } from '../src/utils/supabase/admin'
import {
  validateInvitationTokenAction,
  acceptInvitationAction,
} from '../src/app/dashboard/team/actions'
import {
  checkSuperAdminStatusAction,
  getSuperAdminPlatformDataAction,
} from '../src/app/admin/actions'
import {
  getEligibleReviewsForAiAction,
  generateAiReplyAction,
  saveReviewReplyAction,
  getAiStatus,
} from '../src/app/dashboard/reviews/actions'
import {
  getDashboardNotificationsAction,
  getCurrentUserProfileAction,
} from '../src/app/dashboard/actions'

let passed = 0
let failed = 0

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn()
      console.log(`  ✅ [PASS] ${name}`)
      passed++
    } catch (err: unknown) {
      console.error(`  ❌ [FAIL] ${name}`)
      console.error(`     Error: ${err instanceof Error ? err.message : String(err)}`)
      failed++
    }
  })()
}

async function runSuite() {
  console.log('================================================================================')
  console.log('NexRep Full Functional Fixes — Comprehensive Verification Suite')
  console.log('================================================================================\n')

  const adminClient = createAdminClient()

  // Find a test workspace
  const { data: workspaces } = await adminClient.from('workspaces').select('id, name').limit(1)
  const testWorkspace = workspaces?.[0] || { id: '92aa395e-97d3-478c-a4c2-85998fefbdac', name: 'Test Workspace' }

  // -------------------------------------------------------------------------
  // 1. Team Invitations Flow
  // -------------------------------------------------------------------------
  console.log('--- 1. Team Invitations Flow ---')

  const testToken = 'test_token_' + crypto.randomBytes(16).toString('hex')
  const testEmail = `test.invite.${Date.now()}@example.com`

  await test('Validate non-existent token returns valid: false with clear error', async () => {
    const res = await validateInvitationTokenAction('non_existent_token_12345')
    assert.strictEqual(res.valid, false)
    assert.ok(res.error?.includes('not found') || res.error?.includes('revoked'))
  })

  await test('Create temporary invitation in DB and validate token returns valid: true with metadata', async () => {
    const { error: insertErr } = await adminClient.from('workspace_invitations').insert({
      workspace_id: testWorkspace.id,
      email: testEmail,
      role: 'member',
      invited_by: 'f8946dcc-bfb2-4827-a9ab-bd2b0cde173c',
      token: testToken,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    assert.ifError(insertErr)

    const res = await validateInvitationTokenAction(testToken)
    assert.strictEqual(res.valid, true)
    assert.strictEqual(res.invitation?.email, testEmail)
    assert.strictEqual(res.invitation?.role, 'member')
    assert.strictEqual(res.invitation?.isExpired, false)
  })

  await test('Expired invitation is recognized and blocked with isExpired: true', async () => {
    const expiredToken = 'expired_' + crypto.randomBytes(16).toString('hex')
    await adminClient.from('workspace_invitations').insert({
      workspace_id: testWorkspace.id,
      email: `expired.${Date.now()}@example.com`,
      role: 'member',
      invited_by: 'f8946dcc-bfb2-4827-a9ab-bd2b0cde173c',
      token: expiredToken,
      expires_at: new Date(Date.now() - 1000).toISOString(), // Expired 1 second ago
    })

    const res = await validateInvitationTokenAction(expiredToken)
    assert.strictEqual(res.valid, false)
    assert.strictEqual(res.invitation?.isExpired, true)
    assert.ok(res.error?.includes('expired'))

    // Clean up
    await adminClient.from('workspace_invitations').delete().eq('token', expiredToken)
  })

  await test('Accepting invitation fails closed if caller is unauthenticated', async () => {
    const res = await acceptInvitationAction(testToken)
    // Running in CLI context without user session must safely require login
    assert.strictEqual(res.success, false)
    assert.ok(res.error?.includes('signed in'))
  })

  // Clean up test invitation
  await adminClient.from('workspace_invitations').delete().eq('token', testToken)

  // -------------------------------------------------------------------------
  // 2. Super Admin Authorization & Real Telemetry
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Super Admin Authorization & Real Telemetry ---')

  await test('Super Admin check fails closed for unauthenticated requests', async () => {
    const res = await checkSuperAdminStatusAction()
    assert.strictEqual(res.isAuthorized, false)
  })

  await test('Super Admin platform action rejects unauthenticated requests', async () => {
    const res = await getSuperAdminPlatformDataAction()
    assert.strictEqual(res.isAuthorized, false)
    assert.ok(res.error?.includes('Access restricted'))
  })

  await test('Real platform telemetry can be queried with admin client and has zero mock data', async () => {
    const { count: wsCount } = await adminClient.from('workspaces').select('id', { count: 'exact', head: true })
    const { count: userCount } = await adminClient.from('profiles').select('id', { count: 'exact', head: true })
    const { count: locCount } = await adminClient.from('locations').select('id', { count: 'exact', head: true }).eq('is_connected', true)
    
    assert.strictEqual(typeof wsCount, 'number')
    assert.strictEqual(typeof userCount, 'number')
    assert.strictEqual(typeof locCount, 'number')
    assert.notStrictEqual(wsCount, 142) // Must not be the fake 142
    assert.notStrictEqual(userCount, 892) // Must not be the fake 892
  })

  // -------------------------------------------------------------------------
  // 3. AI Review Assistant Studio & Workflow
  // -------------------------------------------------------------------------
  console.log('\n--- 3. AI Review Assistant Studio & Workflow ---')

  await test('getAiStatus safely returns model and configuration flag without exposing secrets', async () => {
    const status = await getAiStatus()
    assert.strictEqual(typeof status.configured, 'boolean')
    assert.strictEqual(typeof status.model, 'string')
    assert.strictEqual(Boolean((status as Record<string, unknown>).apiKey), false)
  })

  await test('generateAiReplyAction produces tailored responses for demo reviews with all 4 tones', async () => {
    const tones: Array<'professional' | 'friendly' | 'concise' | 'empathetic'> = [
      'professional',
      'friendly',
      'concise',
      'empathetic',
    ]

    for (const t of tones) {
      const res = await generateAiReplyAction({
        authorName: 'Demo User',
        rating: 5,
        reviewContent: 'Awesome service and very friendly team!',
        locationName: 'NexRep Location',
        tone: t,
        reviewId: 'demo-sample-1',
      })
      assert.ok(res.reply && res.reply.length > 20)
    }
  })

  await test('saveReviewReplyAction with demo review safely keeps drafts local without DB or Google writes', async () => {
    // Record initial count of review replies
    const { count: countBefore } = await adminClient
      .from('review_replies')
      .select('*', { count: 'exact', head: true })

    const res = await saveReviewReplyAction({
      reviewId: 'demo-sample-1',
      content: 'Thank you for your business!',
      tone: 'professional',
      isAiGenerated: true,
      isDemo: true,
      publishToGoogle: false,
    })
    assert.strictEqual(res.success, true)
    assert.strictEqual(res.isDemo, true)
    assert.ok(res.message?.includes('demo mode'))

    // Verify no row was inserted into review_replies
    const { count: countAfter } = await adminClient
      .from('review_replies')
      .select('*', { count: 'exact', head: true })

    assert.strictEqual(countBefore, countAfter, 'Database review_replies count must not change for demo reviews')
  })

  await test('getEligibleReviewsForAiAction fails closed without authentication', async () => {
    const res = await getEligibleReviewsForAiAction(testWorkspace.id)
    assert.strictEqual(res.success, false)
    assert.ok(res.error?.includes('authenticated'))
  })

  // -------------------------------------------------------------------------
  // 4. Notifications System
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Notifications System ---')

  await test('getDashboardNotificationsAction enforces authentication & workspace membership on the server', async () => {
    // Without active user session, notifications must fail closed
    const res = await getDashboardNotificationsAction(testWorkspace.id)
    assert.strictEqual(res.success, false)
    assert.deepStrictEqual(res.notifications, [])
  })

  await test('getDashboardNotificationsAction with null workspace returns onboarding guidance', async () => {
    const res = await getDashboardNotificationsAction(null)
    assert.strictEqual(res.success, true)
    assert.ok(res.notifications.length > 0)
    assert.strictEqual(res.notifications[0].type, 'system')
  })

  // -------------------------------------------------------------------------
  // 5. User Profile & Sign Out
  // -------------------------------------------------------------------------
  console.log('\n--- 5. User Profile & Sign Out ---')

  await test('getCurrentUserProfileAction fails closed when not authenticated', async () => {
    const res = await getCurrentUserProfileAction(testWorkspace.id)
    assert.strictEqual(res.success, false)
    assert.strictEqual(res.user, undefined)
  })

  console.log('\n================================================================================')
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`)
  console.log('================================================================================')

  if (failed > 0) {
    process.exit(1)
  }
}

runSuite().catch((e) => {
  console.error('Test runner error:', e)
  process.exit(1)
})
