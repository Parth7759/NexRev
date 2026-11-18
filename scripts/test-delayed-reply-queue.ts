/* eslint-disable */
/**
 * Test Suite: Delayed Auto-Reply Queue, Dedicated Scheduler OIDC Worker & Honest Health Dashboard
 *
 * 100% isolated offline mocked execution — ZERO real Supabase writes, ZERO real Google API calls,
 * ZERO live customer replies published.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { generateKeyPair, SignJWT } from 'jose'
import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database.types'
import {
  computeScheduledFor,
  isJobDueForExecution,
  computeNextRetryAt,
  classifyGoogleError,
  authenticateSchedulerWorkerRequest,
  processSingleClaimedJob,
  ReviewReplyJobRow,
} from '../src/lib/reply-queue'
import { evaluateAutomationHealth } from '../src/lib/automation-health'
import { encryptToken } from '../src/lib/encryption'

interface TestResult {
  suite: string
  name: string
  status: 'PASS' | 'FAIL'
  details: string
}

const results: TestResult[] = []

function assert(condition: boolean, suite: string, name: string, details: string) {
  if (condition) {
    results.push({ suite, name, status: 'PASS', details })
    console.log(`  ✅ [PASS] ${name}`)
  } else {
    results.push({ suite, name, status: 'FAIL', details })
    console.error(`  ❌ [FAIL] ${name} - ${details}`)
  }
}

async function runSuite() {
  console.log('================================================================================')
  console.log('NexRep Delayed Reply Queue, OIDC Scheduler Worker & Health Dashboard Test Suite')
  console.log('================================================================================')

  // =========================================================================
  // SUITE 1: Delay Enforcement, Exponential Backoff & Error Classification
  // =========================================================================
  console.log('\n--- Suite 1: Delay Enforcement & Error Classification ---')

  const baseNow = Date.parse('2026-11-18T10:00:00.000Z')
  const sched5m = computeScheduledFor(5, baseNow)
  assert(
    sched5m === '2026-11-18T10:05:00.000Z',
    'Suite 1',
    'computeScheduledFor(5) schedules exact +5 minutes UTC',
    `Got: ${sched5m}`
  )

  assert(
    isJobDueForExecution(sched5m, baseNow + 4 * 60_000 + 59_999) === false,
    'Suite 1',
    'isJobDueForExecution rejects job even 1ms before scheduled_for',
    `Expected false`
  )

  assert(
    isJobDueForExecution(sched5m, baseNow + 5 * 60_000) === true &&
      isJobDueForExecution(sched5m, baseNow + 6 * 60_000) === true,
    'Suite 1',
    'isJobDueForExecution allows execution at or after scheduled_for',
    `Expected true`
  )

  assert(
    computeNextRetryAt(1, baseNow) === '2026-11-18T10:02:00.000Z' &&
      computeNextRetryAt(2, baseNow) === '2026-11-18T10:04:00.000Z' &&
      computeNextRetryAt(3, baseNow) === '2026-11-18T10:08:00.000Z' &&
      computeNextRetryAt(10, baseNow) === '2026-11-18T11:00:00.000Z',
    'Suite 1',
    'computeNextRetryAt applies exponential backoff capped at 60m',
    `Got: ${computeNextRetryAt(1, baseNow)}, ${computeNextRetryAt(10, baseNow)}`
  )

  assert(
    classifyGoogleError('404 Requested entity was not found.') === 'not_found' &&
      classifyGoogleError('Token refresh failed: invalid_grant') === 'revoked' &&
      classifyGoogleError('403 PERMISSION_DENIED') === 'permission_denied' &&
      classifyGoogleError('503 Service Unavailable') === 'transient',
    'Suite 1',
    'classifyGoogleError accurately categorizes 404, revoked, 403, and transient failures',
    `Unexpected classification`
  )

  // =========================================================================
  // SUITE 2: Dedicated Cloud Scheduler OIDC Authentication
  // =========================================================================
  console.log('\n--- Suite 2: Dedicated Cloud Scheduler OIDC Worker Auth ---')

  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const WORKER_AUD = 'https://nex-rev-staging.vercel.app/api/workers/process-scheduled-replies'
  const WORKER_SA = 'scheduler-worker-staging@ai-review-manager-511010.iam.gserviceaccount.com'
  const PUBSUB_SA = 'pubsub-invoker@ai-review-manager-511010.iam.gserviceaccount.com'

  const origAud = process.env.GOOGLE_SCHEDULER_WORKER_AUDIENCE
  const origSa = process.env.GOOGLE_SCHEDULER_WORKER_SERVICE_ACCOUNT
  process.env.GOOGLE_SCHEDULER_WORKER_AUDIENCE = WORKER_AUD
  process.env.GOOGLE_SCHEDULER_WORKER_SERVICE_ACCOUNT = WORKER_SA

  async function signToken(email: string, audience: string) {
    return await new SignJWT({ email, email_verified: true })
      .setProtectedHeader({ alg: 'RS256', kid: 'scheduler-key-1' })
      .setIssuer('https://accounts.google.com')
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey)
  }

  try {
    // 2.1 Reject missing header
    const missingAuthReq = new NextRequest(WORKER_AUD, { method: 'POST' })
    const missingRes = await authenticateSchedulerWorkerRequest(missingAuthReq, { keyResolver: publicKey })
    assert(
      missingRes.authenticated === false && missingRes.status === 401,
      'Suite 2',
      'Rejects unauthenticated worker POST with HTTP 401',
      `Got: ${JSON.stringify(missingRes)}`
    )

    // 2.2 Reject query string secret
    const querySecretReq = new NextRequest(`${WORKER_AUD}?secret=anything`, { method: 'POST' })
    const queryRes = await authenticateSchedulerWorkerRequest(querySecretReq, { keyResolver: publicKey })
    assert(
      queryRes.authenticated === false && queryRes.status === 401,
      'Suite 2',
      'Rejects query-string secret credentials on worker endpoint with HTTP 401',
      `Got: ${JSON.stringify(queryRes)}`
    )

    // 2.3 Reject Pub/Sub service account token (strict SA isolation!)
    const pubsubToken = await signToken(PUBSUB_SA, WORKER_AUD)
    const pubsubReq = new NextRequest(WORKER_AUD, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pubsubToken}` },
    })
    const pubsubAuthRes = await authenticateSchedulerWorkerRequest(pubsubReq, { keyResolver: publicKey })
    assert(
      pubsubAuthRes.authenticated === false && pubsubAuthRes.status === 401,
      'Suite 2',
      'Rejects Pub/Sub service account token on dedicated Scheduler worker endpoint (HTTP 401)',
      `Got: ${JSON.stringify(pubsubAuthRes)}`
    )

    // 2.4 Reject wrong audience
    const wrongAudToken = await signToken(
      WORKER_SA,
      'https://nex-rev-staging.vercel.app/api/webhooks/google-pubsub'
    )
    const wrongAudReq = new NextRequest(WORKER_AUD, {
      method: 'POST',
      headers: { Authorization: `Bearer ${wrongAudToken}` },
    })
    const wrongAudRes = await authenticateSchedulerWorkerRequest(wrongAudReq, { keyResolver: publicKey })
    assert(
      wrongAudRes.authenticated === false && wrongAudRes.status === 401,
      'Suite 2',
      'Rejects mismatched OIDC audience with HTTP 401',
      `Got: ${JSON.stringify(wrongAudRes)}`
    )

    // 2.5 Accept valid dedicated Cloud Scheduler OIDC JWT
    const validWorkerToken = await signToken(WORKER_SA, WORKER_AUD)
    const validWorkerReq = new NextRequest(WORKER_AUD, {
      method: 'POST',
      headers: { Authorization: `Bearer ${validWorkerToken}` },
    })
    const validRes = await authenticateSchedulerWorkerRequest(validWorkerReq, { keyResolver: publicKey })
    assert(
      validRes.authenticated === true &&
        validRes.triggerSource === 'cloud_scheduler_oidc' &&
        validRes.serviceAccount === WORKER_SA,
      'Suite 2',
      'Accepts valid Google-signed OIDC JWT from dedicated scheduler-worker-staging SA',
      `Got: ${JSON.stringify(validRes)}`
    )

    // 2.6 Dual-mode coexistence: dedicated WORKER_SCHEDULER_SECRET works for supabase_cron without weakening OIDC
    const origWorkerSecret = process.env.WORKER_SCHEDULER_SECRET
    const testHighEntropySecret = 'a'.repeat(64)
    process.env.WORKER_SCHEDULER_SECRET = testHighEntropySecret
    try {
      const cronReq = new NextRequest(WORKER_AUD, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${testHighEntropySecret}`,
          'x-nexrep-scheduler-source': 'supabase_cron',
        },
      })
      const cronRes = await authenticateSchedulerWorkerRequest(cronReq, { keyResolver: publicKey })
      assert(
        cronRes.authenticated === true && cronRes.triggerSource === 'supabase_cron',
        'Suite 2',
        'Accepts dedicated WORKER_SCHEDULER_SECRET and records triggerSource=supabase_cron',
        `Got: ${JSON.stringify(cronRes)}`
      )

      // 2.7 Pub/Sub JWT is STILL rejected even when WORKER_SCHEDULER_SECRET is also enabled
      const pubsubStillRejected = await authenticateSchedulerWorkerRequest(pubsubReq, {
        keyResolver: publicKey,
      })
      assert(
        pubsubStillRejected.authenticated === false && pubsubStillRejected.status === 401,
        'Suite 2',
        'Pub/Sub JWT remains strictly rejected (401) when WORKER_SCHEDULER_SECRET is configured',
        `Got: ${JSON.stringify(pubsubStillRejected)}`
      )

      // 2.8 Valid Cloud Scheduler OIDC JWT STILL passes with cloud_scheduler_oidc
      const oidcStillPasses = await authenticateSchedulerWorkerRequest(validWorkerReq, {
        keyResolver: publicKey,
      })
      assert(
        oidcStillPasses.authenticated === true &&
          oidcStillPasses.triggerSource === 'cloud_scheduler_oidc',
        'Suite 2',
        'Cloud Scheduler OIDC remains fully intact when WORKER_SCHEDULER_SECRET is configured',
        `Got: ${JSON.stringify(oidcStillPasses)}`
      )

      // 2.9 Rejects wrong static Bearer secret with 401
      const wrongSecretReq = new NextRequest(WORKER_AUD, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${'b'.repeat(64)}`,
          'x-nexrep-scheduler-source': 'supabase_cron',
        },
      })
      const wrongSecretRes = await authenticateSchedulerWorkerRequest(wrongSecretReq, {
        keyResolver: publicKey,
      })
      assert(
        wrongSecretRes.authenticated === false && wrongSecretRes.status === 401,
        'Suite 2',
        'Rejects mismatched static Bearer secret with HTTP 401',
        `Got: ${JSON.stringify(wrongSecretRes)}`
      )

      // 2.10 Rejects SUPABASE_SERVICE_ROLE_KEY as worker credential (401 caller / 500 misconfig)
      const srKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key-at-least-32-chars'
      const srCallerReq = new NextRequest(WORKER_AUD, {
        method: 'POST',
        headers: { Authorization: `Bearer ${srKey}` },
      })
      const srCallerRes = await authenticateSchedulerWorkerRequest(srCallerReq, {
        keyResolver: publicKey,
      })
      assert(
        srCallerRes.authenticated === false && srCallerRes.status === 401,
        'Suite 2',
        'Explicitly rejects SUPABASE_SERVICE_ROLE_KEY sent as worker Bearer token (HTTP 401)',
        `Got: ${JSON.stringify(srCallerRes)}`
      )
    } finally {
      if (origWorkerSecret === undefined) delete process.env.WORKER_SCHEDULER_SECRET
      else process.env.WORKER_SCHEDULER_SECRET = origWorkerSecret
    }
  } finally {
    if (origAud === undefined) delete process.env.GOOGLE_SCHEDULER_WORKER_AUDIENCE
    else process.env.GOOGLE_SCHEDULER_WORKER_AUDIENCE = origAud
    if (origSa === undefined) delete process.env.GOOGLE_SCHEDULER_WORKER_SERVICE_ACCOUNT
    else process.env.GOOGLE_SCHEDULER_WORKER_SERVICE_ACCOUNT = origSa
  }

  // =========================================================================
  // SUITE 3: Worker Execution Safety (Offline Mocked)
  // =========================================================================
  console.log('\n--- Suite 3: Worker Execution Safety & Policy Preservation ---')

  const originalFetch = globalThis.fetch
  const fakeAccessToken = encryptToken('mock-access-token')
  const fakeRefreshToken = encryptToken('mock-refresh-token')

  let scenario: '404' | 'merchant_reply' | 'revoked_oauth' | 'google_503' | 'manual_approval' | 'auto_publish' = '404'
  const calls = {
    openAi: 0,
    googlePublish: 0,
    jobUpdates: [] as any[],
    healthUpserts: [] as any[],
  }

  function resetCalls() {
    calls.openAi = 0
    calls.googlePublish = 0
    calls.jobUpdates = []
    calls.healthUpserts = []
  }

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const method = (init?.method || 'GET').toUpperCase()

    // Mock Google OAuth token refresh (for revoked scenario)
    if (urlStr.includes('oauth2.googleapis.com/token')) {
      return new Response(
        JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Mock GBP single review GET
    if (urlStr.includes('mybusiness.googleapis.com/v4/accounts/') && urlStr.includes('/reviews/') && method === 'GET') {
      if (scenario === '404') {
        return new Response(
          JSON.stringify({ error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' } }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        )
      }
      if (scenario === 'google_503') {
        return new Response(
          JSON.stringify({ error: { code: 503, message: 'Service Unavailable' } }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      }
      if (scenario === 'merchant_reply') {
        return new Response(
          JSON.stringify({
            reviewId: 'rev-ext-1',
            reviewer: { displayName: 'Alice' },
            starRating: 'FIVE',
            comment: 'Loved it!',
            createTime: '2026-11-18T10:00:00Z',
            reviewReply: { comment: 'Thanks Alice from owner!', updateTime: '2026-11-18T10:02:00Z' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return new Response(
        JSON.stringify({
          reviewId: 'rev-ext-1',
          reviewer: { displayName: 'Alice' },
          starRating: 'FIVE',
          comment: 'Wonderful experience!',
          createTime: '2026-11-18T10:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Mock GBP reply publish PUT
    if (urlStr.includes('/reply') && method === 'PUT') {
      calls.googlePublish++
      return new Response(
        JSON.stringify({ comment: 'Thank you Alice!', updateTime: '2026-11-18T10:06:00Z' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Mock OpenAI
    if (urlStr.includes('api.openai.com/v1/chat/completions')) {
      calls.openAi++
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-worker-mock',
          choices: [{ message: { role: 'assistant', content: 'Thank you so much, Alice, for the wonderful review!' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Mock Supabase REST
    if (urlStr.includes('.supabase.co/rest/v1/')) {
      if (urlStr.includes('/review_reply_jobs') && method === 'PATCH') {
        try { calls.jobUpdates.push(JSON.parse(String(init?.body || '{}'))) } catch {}
        return new Response(JSON.stringify([{}]), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (urlStr.includes('/google_connection_health')) {
        try { calls.healthUpserts.push(JSON.parse(String(init?.body || '{}'))) } catch {}
        return new Response(JSON.stringify([{}]), { status: 201, headers: { 'Content-Type': 'application/json' } })
      }
      if (urlStr.includes('/google_integrations')) {
        return new Response(
          JSON.stringify({
            id: 'integ-1',
            workspace_id: 'ws-1',
            account_id: 'accounts/108611198428245728238',
            account_name: 'test@example.com',
            access_token_encrypted: fakeAccessToken,
            refresh_token_encrypted: fakeRefreshToken,
            expires_at:
              scenario === 'revoked_oauth'
                ? '2020-01-01T00:00:00Z' // forces refresh -> hits invalid_grant
                : new Date(Date.now() + 3600 * 1000).toISOString(),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      if (urlStr.includes('/locations')) {
        const locObj = {
          id: 'loc-1',
          workspace_id: 'ws-1',
          name: 'NexFlowOps Technologies Pvt. Ltd.',
          google_account_id: 'accounts/108611198428245728238',
          google_location_id: 'locations/7435614085041125705',
          is_connected: true,
        }
        const accept = String((init?.headers as Record<string, string>)?.Accept || (init?.headers as Record<string, string>)?.accept || '')
        if (accept.includes('vnd.pgrst.object')) {
          return new Response(JSON.stringify(locObj), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        return new Response(JSON.stringify([locObj]), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (urlStr.includes('/workspace_settings')) {
        return new Response(
          JSON.stringify({
            workspace_id: 'ws-1',
            auto_reply_mode: scenario === 'manual_approval' ? 'manual_approval' : 'auto_publish_all',
            require_approval_for_critical: scenario === 'manual_approval',
            default_reply_tone: 'friendly',
            business_context: 'NexFlowOps',
            auto_reply_min_rating: 1,
            auto_reply_delay_minutes: 5,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      if (urlStr.includes('/reviews') && !urlStr.includes('/review_replies') && !urlStr.includes('/review_reply_logs')) {
        if (method === 'GET') {
          return new Response(
            JSON.stringify({
              id: 'rev-db-1',
              workspace_id: 'ws-1',
              rating: 5,
              content: 'Wonderful experience!',
              author_name: 'Alice',
              external_review_id: 'rev-ext-1',
              location_id: 'loc-1',
              status: 'unanswered',
              locations: {
                name: 'NexFlowOps Technologies Pvt. Ltd.',
                google_location_id: 'locations/7435614085041125705',
                google_account_id: 'accounts/108611198428245728238',
                is_connected: true,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }
        return new Response(JSON.stringify([{}]), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (urlStr.includes('/review_replies')) {
        if (method === 'GET') {
          return new Response(JSON.stringify(null), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        return new Response(JSON.stringify({ id: 'reply-1' }), { status: 201, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify([{}]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    return originalFetch(input, init)
  }

  const mockSupabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mock.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-key',
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  function makeJob(overrides?: Partial<ReviewReplyJobRow>): ReviewReplyJobRow {
    return {
      id: 'job-1',
      workspace_id: 'ws-1',
      location_id: 'loc-1',
      review_id: 'rev-db-1',
      external_review_id: 'rev-ext-1',
      source_event_id: 'evt-1',
      source_event_type: 'NEW_REVIEW',
      status: 'processing',
      scheduled_for: '2026-11-18T10:05:00.000Z',
      locked_at: '2026-11-18T10:06:00.000Z',
      locked_by: 'worker-test',
      attempts: 1,
      max_attempts: 5,
      next_retry_at: null,
      last_error: null,
      processed_at: null,
      metadata: {},
      created_at: '2026-11-18T10:00:00.000Z',
      updated_at: '2026-11-18T10:06:00.000Z',
      ...overrides,
    }
  }

  try {
    // 3.1 Premature job before scheduled_for -> deferred cleanly with ZERO OpenAI/Google calls
    resetCalls()
    const prematureRes = await processSingleClaimedJob(
      mockSupabase,
      makeJob({ scheduled_for: '2026-11-18T10:05:00.000Z', attempts: 1 }),
      { nowMs: Date.parse('2026-11-18T10:03:00.000Z') }
    )
    assert(
      prematureRes.outcome === 'deferred_premature' &&
        calls.openAi === 0 &&
        calls.googlePublish === 0 &&
        calls.jobUpdates[0]?.status === 'scheduled' &&
        calls.jobUpdates[0]?.attempts === 0,
      'Suite 3',
      'Worker layer strictly defers premature job before scheduled_for (0 AI/Google calls)',
      `Outcome: ${JSON.stringify(prematureRes)}, Updates: ${JSON.stringify(calls.jobUpdates)}`
    )

    // 3.2 Google 404 -> permanently skipped (no retry storm, no OpenAI)
    resetCalls()
    scenario = '404'
    const res404 = await processSingleClaimedJob(mockSupabase, makeJob(), {
      nowMs: Date.parse('2026-11-18T10:06:00.000Z'),
    })
    assert(
      res404.outcome === 'skipped' && calls.openAi === 0 && calls.googlePublish === 0,
      'Suite 3',
      'Google 404 review is permanently skipped without AI generation or retry loop',
      `Got: ${JSON.stringify(res404)}`
    )

    // 3.3 External merchant reply posted during delay window -> skipped (never overwrites!)
    resetCalls()
    scenario = 'merchant_reply'
    const resMerchant = await processSingleClaimedJob(mockSupabase, makeJob(), {
      nowMs: Date.parse('2026-11-18T10:06:00.000Z'),
    })
    assert(
      resMerchant.outcome === 'skipped' && calls.openAi === 0 && calls.googlePublish === 0,
      'Suite 3',
      'Merchant reply posted during 5m delay protects against AI overwrite',
      `Got: ${JSON.stringify(resMerchant)}`
    )

    // 3.4 Revoked Google OAuth -> dead_letter + google_connection_health set to revoked
    resetCalls()
    scenario = 'revoked_oauth'
    const resRevoked = await processSingleClaimedJob(mockSupabase, makeJob(), {
      nowMs: Date.parse('2026-11-18T10:06:00.000Z'),
    })
    assert(
      resRevoked.outcome === 'dead_letter' &&
        calls.healthUpserts.some((h) => h.status === 'revoked') &&
        calls.openAi === 0,
      'Suite 3',
      'Revoked OAuth marks google_connection_health=revoked and dead-letters job cleanly',
      `Outcome: ${JSON.stringify(resRevoked)}, Health: ${JSON.stringify(calls.healthUpserts)}`
    )

    // 3.5 Transient Google 503 -> failed with exponential backoff next_retry_at
    resetCalls()
    scenario = 'google_503'
    const res503 = await processSingleClaimedJob(mockSupabase, makeJob({ attempts: 2 }), {
      nowMs: Date.parse('2026-11-18T10:06:00.000Z'),
    })
    assert(
      res503.outcome === 'failed' &&
        calls.jobUpdates[0]?.status === 'failed' &&
        calls.jobUpdates[0]?.next_retry_at === '2026-11-18T10:10:00.000Z',
      'Suite 3',
      'Transient Google 503 schedules exponential backoff retry (+4m on attempt 2)',
      `Outcome: ${JSON.stringify(res503)}, Update: ${JSON.stringify(calls.jobUpdates)}`
    )

    // 3.6 Manual approval policy preserved after delay -> draft_saved, ZERO Google publish
    resetCalls()
    scenario = 'manual_approval'
    const resManual = await processSingleClaimedJob(mockSupabase, makeJob(), {
      nowMs: Date.parse('2026-11-18T10:06:00.000Z'),
    })
    assert(
      resManual.outcome === 'draft_saved' && calls.openAi === 1 && calls.googlePublish === 0,
      'Suite 3',
      'Manual approval policy saves AI draft after delay without publishing to Google',
      `Outcome: ${JSON.stringify(resManual)}, openAi=${calls.openAi}, googlePublish=${calls.googlePublish}`
    )

    // 3.7 Auto-publish policy after delay -> generates + publishes to mocked Google + verifies connection health
    resetCalls()
    scenario = 'auto_publish'
    const resAuto = await processSingleClaimedJob(mockSupabase, makeJob(), {
      nowMs: Date.parse('2026-11-18T10:06:00.000Z'),
    })
    assert(
      resAuto.outcome === 'published' &&
        calls.openAi === 1 &&
        calls.googlePublish === 1 &&
        calls.healthUpserts.some((h) => h.status === 'connected_verified'),
      'Suite 3',
      'Auto-publish policy publishes due job after delay and updates verified health',
      `Outcome: ${JSON.stringify(resAuto)}, openAi=${calls.openAi}, googlePublish=${calls.googlePublish}`
    )
  } finally {
    globalThis.fetch = originalFetch
  }

  // =========================================================================
  // SUITE 4: Honest 5-Stage Dashboard Health State Machine
  // =========================================================================
  console.log('\n--- Suite 4: Evidence-Based Dashboard Health Classification ---')

  const now = Date.parse('2026-11-18T12:00:00.000Z')
  const baseInput = {
    nowMs: now,
    autoReplyMode: 'auto_publish_all' as const,
    requireApprovalForCritical: false,
    autoReplyDelayMinutes: 5,
    isFullyAutomatic: true,
    hasStoredIntegrationRow: true,
    hasRequiredBusinessManageScope: true,
    connectedLocationCount: 1,
    connectionHealthRow: {
      status: 'connected_verified' as const,
      lastRefreshSucceededAt: '2026-11-18T11:50:00.000Z',
      lastGbpApiVerifiedAt: '2026-11-18T11:50:00.000Z',
      lastCheckedAt: '2026-11-18T11:50:00.000Z',
      lastErrorCode: null,
      lastErrorMessage: null,
    },
    lastPubSubEventAt: '2026-11-18T11:40:00.000Z',
    lastPubSubEventStatus: 'published',
    lastWorkerRunAt: '2026-11-18T11:59:00.000Z',
    lastWorkerRunStatus: 'succeeded' as const,
    scheduledJobCount: 0,
    processingJobCount: 0,
    failedJobCount: 0,
    deadLetterJobCount: 0,
    failedReplyCount: 0,
    nextScheduledFor: null,
    lastAiAutoPublishedAt: '2026-11-18T11:45:00.000Z',
    unansweredReviewCount: 0,
  }

  // 4.1 Stored token only (no verified GBP API probe) -> NEVER claims Connected or Active!
  const unverifiedConn = evaluateAutomationHealth({
    ...baseInput,
    connectionHealthRow: null,
  })
  assert(
    unverifiedConn.connected.status === 'token_stored_unverified' &&
      unverifiedConn.overallStatus === 'degraded_unverified_connection',
    'Suite 4',
    'Stored DB token without GBP API verification is flagged token_stored_unverified (never Connected)',
    `Got: ${unverifiedConn.connected.status} / ${unverifiedConn.overallStatus}`
  )

  // 4.2 Settings enabled + verified API, but worker heartbeat stale (>5m) -> degraded_worker_offline
  const workerStale = evaluateAutomationHealth({
    ...baseInput,
    lastWorkerRunAt: '2026-11-18T11:40:00.000Z',
  })
  assert(
    workerStale.processing.workerHealthy === false &&
      workerStale.overallStatus === 'degraded_worker_offline',
    'Suite 4',
    'Stale worker heartbeat (>5m) flags degraded_worker_offline even when settings are enabled',
    `Got: ${workerStale.overallStatus}`
  )

  // 4.3 Configured + verified API + healthy worker, but 0 real AI auto-publishes yet -> ready_awaiting_event
  const awaitingFirst = evaluateAutomationHealth({
    ...baseInput,
    lastPubSubEventAt: null,
    lastAiAutoPublishedAt: null,
  })
  assert(
    awaitingFirst.overallStatus === 'ready_awaiting_event' &&
      !awaitingFirst.headline.includes('Verified & Active'),
    'Suite 4',
    'Zero real auto-publishes shows ready_awaiting_event instead of Verified & Active',
    `Got: ${awaitingFirst.overallStatus} ("${awaitingFirst.headline}")`
  )

  // 4.4 Revoked Google OAuth -> degraded_auth_required
  const revokedHealth = evaluateAutomationHealth({
    ...baseInput,
    connectionHealthRow: {
      ...baseInput.connectionHealthRow,
      status: 'revoked',
      lastErrorCode: 'revoked',
      lastErrorMessage: 'invalid_grant',
    },
  })
  assert(
    revokedHealth.overallStatus === 'degraded_auth_required',
    'Suite 4',
    'Revoked OAuth immediately flags degraded_auth_required',
    `Got: ${revokedHealth.overallStatus}`
  )

  // 4.5 Manual approval mode -> manual_mode
  const manualHealth = evaluateAutomationHealth({
    ...baseInput,
    autoReplyMode: 'manual_approval',
    isFullyAutomatic: false,
  })
  assert(
    manualHealth.overallStatus === 'manual_mode',
    'Suite 4',
    'Manual approval mode shows manual_mode',
    `Got: ${manualHealth.overallStatus}`
  )

  // 4.6 All 5 stages genuinely verified -> verified_active
  const verifiedHealth = evaluateAutomationHealth(baseInput)
  assert(
    verifiedHealth.overallStatus === 'verified_active' &&
      verifiedHealth.connected.status === 'connected_verified' &&
      verifiedHealth.processing.workerHealthy === true &&
      verifiedHealth.publishing.hasVerifiedAutoPublish === true,
    'Suite 4',
    'Shows verified_active ONLY when all 5 stages (config, GBP API, Pub/Sub, worker, AI publish) pass',
    `Got: ${verifiedHealth.overallStatus}`
  )

  console.log('\n================================================================================')
  console.log('FINAL DELAYED QUEUE, WORKER & HEALTH TEST SUMMARY')
  console.log('================================================================================')
  const total = results.length
  const passed = results.filter((r) => r.status === 'PASS').length
  const failed = results.filter((r) => r.status === 'FAIL').length
  console.log(`Total Assertions: ${total}`)
  console.log(`Passed:           ${passed}`)
  console.log(`Failed:           ${failed}`)

  if (failed > 0) {
    console.error(`\n❌ ${failed} TEST(S) FAILED!`)
    process.exit(1)
  } else {
    console.log(`\n🎉 ALL ${passed} DELAYED QUEUE, WORKER & HEALTH TESTS PASSED!`)
  }
}

runSuite().catch((err) => {
  console.error(err)
  process.exit(1)
})

