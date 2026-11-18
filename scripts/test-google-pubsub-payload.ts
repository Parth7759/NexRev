/* eslint-disable */
/**
 * Test Suite: Google Business Profile Pub/Sub Payload Parser & Webhook Regression Tests
 *
 * Covers:
 * 1. Real Google GBP Notifications v1 payload (NEW_REVIEW with string review & location).
 * 2. Real Google GBP Notifications v1 payload (UPDATED_REVIEW with string review & location).
 * 3. Exact accountId, locationId, reviewId extraction.
 * 4. Existing object-based review.name format compatibility.
 * 5. Missing or malformed resource names.
 * 6. End-to-end webhook POST regression tests (100% mocked fetch — zero live DB/Google calls):
 *    - Real Google payload proceeds through event persistence, review fetch, and upsert.
 *    - Transient DB and Google API failures return retryable HTTP 500.
 *    - Duplicate event protection prevents reprocessing already-processed messageIds.
 *    - Malformed payloads handled safely without exposing secrets.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { NextRequest } from 'next/server'
import { parseGooglePubSubNotificationPayload } from '../src/lib/google-pubsub-payload'
import { POST as webhookPost } from '../src/app/api/webhooks/google-pubsub/route'
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

const REAL_ACCOUNT_ID = '108611198428245728238'
const REAL_LOCATION_ID = '7435614085041125705'
const REAL_REVIEW_ID =
  'AbFvOqm5v8TJTyMt2L9HEcxkYMe9KlbgUfJ6W9EeSLpNbQGdAgbh45MzviLcKe6EkIoDc6_QatQ0OQ'
const REAL_LOCATION_RESOURCE = `accounts/${REAL_ACCOUNT_ID}/locations/${REAL_LOCATION_ID}`
const REAL_REVIEW_RESOURCE = `accounts/${REAL_ACCOUNT_ID}/locations/${REAL_LOCATION_ID}/reviews/${REAL_REVIEW_ID}`

const REAL_GOOGLE_NEW_REVIEW_PAYLOAD = {
  type: 'NEW_REVIEW',
  location: REAL_LOCATION_RESOURCE,
  review: REAL_REVIEW_RESOURCE,
}

const REAL_GOOGLE_UPDATED_REVIEW_PAYLOAD = {
  type: 'UPDATED_REVIEW',
  location: REAL_LOCATION_RESOURCE,
  review: REAL_REVIEW_RESOURCE,
}

async function runPayloadTests() {
  console.log('================================================================================')
  console.log('NexRep Google Business Profile Pub/Sub Payload Parser & Regression Test Suite')
  console.log('================================================================================')

  // =========================================================================
  // SUITE 1: Pure Payload Parser Unit Tests
  // =========================================================================
  console.log('\n--- Suite 1: Payload Parser Unit Tests ---')

  // 1.1 Real Google NEW_REVIEW payload (string review + string location + type)
  const parsedNew = parseGooglePubSubNotificationPayload(REAL_GOOGLE_NEW_REVIEW_PAYLOAD)
  assert(
    parsedNew.eventType === 'NEW_REVIEW' &&
      parsedNew.isReviewEvent === true &&
      parsedNew.hasRequiredIdentifiers === true &&
      parsedNew.accountId === REAL_ACCOUNT_ID &&
      parsedNew.locationId === REAL_LOCATION_ID &&
      parsedNew.reviewId === REAL_REVIEW_ID &&
      parsedNew.rawResourceName === REAL_REVIEW_RESOURCE &&
      parsedNew.locationResourceName === REAL_LOCATION_RESOURCE &&
      parsedNew.embeddedReview === null,
    'Suite 1',
    'Parses exact real Google NEW_REVIEW payload (type + string location + string review)',
    `Got: ${JSON.stringify(parsedNew)}`
  )

  // 1.2 Real Google UPDATED_REVIEW payload
  const parsedUpdated = parseGooglePubSubNotificationPayload(REAL_GOOGLE_UPDATED_REVIEW_PAYLOAD)
  assert(
    parsedUpdated.eventType === 'UPDATED_REVIEW' &&
      parsedUpdated.isReviewEvent === true &&
      parsedUpdated.hasRequiredIdentifiers === true &&
      parsedUpdated.accountId === REAL_ACCOUNT_ID &&
      parsedUpdated.locationId === REAL_LOCATION_ID &&
      parsedUpdated.reviewId === REAL_REVIEW_ID,
    'Suite 1',
    'Parses exact real Google UPDATED_REVIEW payload (type + string location + string review)',
    `Got: ${JSON.stringify(parsedUpdated)}`
  )

  // 1.3 Existing object-based review.name compatibility
  const objectPayload = {
    eventType: 'NEW_REVIEW',
    review: {
      name: REAL_REVIEW_RESOURCE,
      reviewId: REAL_REVIEW_ID,
      starRating: 'FIVE',
      comment: 'Fantastic Service',
      reviewer: { displayName: 'realai' },
    },
  }
  const parsedObj = parseGooglePubSubNotificationPayload(objectPayload)
  assert(
    parsedObj.eventType === 'NEW_REVIEW' &&
      parsedObj.hasRequiredIdentifiers === true &&
      parsedObj.accountId === REAL_ACCOUNT_ID &&
      parsedObj.locationId === REAL_LOCATION_ID &&
      parsedObj.reviewId === REAL_REVIEW_ID &&
      parsedObj.embeddedReview?.comment === 'Fantastic Service',
    'Suite 1',
    'Preserves compatibility with object-based review.name format',
    `Got: ${JSON.stringify(parsedObj)}`
  )

  // 1.4 Legacy resourceName format compatibility
  const legacyResPayload = {
    event_type: 'UPDATED_REVIEW',
    resourceName: 'accounts/111/locations/222/reviews/rev_333',
  }
  const parsedLegacy = parseGooglePubSubNotificationPayload(legacyResPayload)
  assert(
    parsedLegacy.eventType === 'UPDATED_REVIEW' &&
      parsedLegacy.accountId === '111' &&
      parsedLegacy.locationId === '222' &&
      parsedLegacy.reviewId === 'rev_333' &&
      parsedLegacy.hasRequiredIdentifiers === true,
    'Suite 1',
    'Preserves compatibility with legacy event_type and resourceName format',
    `Got: ${JSON.stringify(parsedLegacy)}`
  )

  // 1.5 Split location resource string + reviews/{id}
  const splitPayload = {
    type: 'NEW_REVIEW',
    location: REAL_LOCATION_RESOURCE,
    review: `reviews/${REAL_REVIEW_ID}`,
  }
  const parsedSplit = parseGooglePubSubNotificationPayload(splitPayload)
  assert(
    parsedSplit.accountId === REAL_ACCOUNT_ID &&
      parsedSplit.locationId === REAL_LOCATION_ID &&
      parsedSplit.reviewId === REAL_REVIEW_ID &&
      parsedSplit.hasRequiredIdentifiers === true,
    'Suite 1',
    'Extracts accountId/locationId from location and reviewId from reviews/{id}',
    `Got: ${JSON.stringify(parsedSplit)}`
  )

  // 1.6 Non-review Google event via `type`
  const nonReviewPayload = {
    type: 'GOOGLE_UPDATE',
    location: REAL_LOCATION_RESOURCE,
  }
  const parsedNonReview = parseGooglePubSubNotificationPayload(nonReviewPayload)
  assert(
    parsedNonReview.eventType === 'GOOGLE_UPDATE' && parsedNonReview.isReviewEvent === false,
    'Suite 1',
    'Recognizes non-review event type from payload.type',
    `Got: ${JSON.stringify(parsedNonReview)}`
  )

  // 1.7 Malformed / missing resource names
  const malformedCases = [
    { label: 'Empty object', payload: {} },
    { label: 'Missing review', payload: { type: 'NEW_REVIEW', location: REAL_LOCATION_RESOURCE } },
    { label: 'Malformed review string', payload: { type: 'NEW_REVIEW', location: 'bad', review: 'not-a-resource' } },
    { label: 'Truncated review resource (no reviewId)', payload: { type: 'NEW_REVIEW', review: REAL_LOCATION_RESOURCE } },
    {
      label: 'Empty location segment',
      payload: { type: 'NEW_REVIEW', review: 'accounts/123/locations//reviews/rev1' },
    },
    {
      label: 'Empty reviewId segment',
      payload: { type: 'NEW_REVIEW', review: 'accounts/123/locations/456/reviews/' },
    },
  ]

  for (const mc of malformedCases) {
    const res = parseGooglePubSubNotificationPayload(mc.payload)
    assert(
      res.hasRequiredIdentifiers === false,
      'Suite 1',
      `Rejects malformed/incomplete payload: ${mc.label}`,
      `Expected hasRequiredIdentifiers=false, got: ${JSON.stringify(res)}`
    )
  }

  // =========================================================================
  // SUITE 2: Webhook End-to-End Regression Tests (100% Mocked Offline)
  // =========================================================================
  console.log('\n--- Suite 2: Webhook POST Regression & Acknowledgement Safety Tests ---')

  const originalToken = process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN
  const originalAudience = process.env.GOOGLE_PUBSUB_PUSH_AUDIENCE
  const originalSA = process.env.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT
  const originalFetch = globalThis.fetch

  delete process.env.GOOGLE_PUBSUB_PUSH_AUDIENCE
  delete process.env.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT
  process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN = 'test-regression-token-xyz'

  // Mock state flags
  let mockMode: 'happy' | 'db_error' | 'google_503' | 'duplicate_event' = 'happy'
  const observedCalls = {
    gbpFetchUrl: '',
    recordedEvents: [] as any[],
    upsertedReviews: [] as any[],
    enqueuedJobs: [] as any[],
    openAiCalled: false,
    googlePublishCalled: false,
  }

  const fakeEncryptedAccessToken = encryptToken('mock-fresh-google-access-token')
  const fakeEncryptedRefreshToken = encryptToken('mock-refresh-token')

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const method = (init?.method || 'GET').toUpperCase()

    // Mock Google Business Profile single review GET
    if (urlStr.includes('mybusiness.googleapis.com/v4/accounts/') && urlStr.includes('/reviews/') && method === 'GET') {
      observedCalls.gbpFetchUrl = urlStr
      if (mockMode === 'google_503') {
        return new Response(JSON.stringify({ error: { code: 503, message: 'Service Unavailable' } }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(
        JSON.stringify({
          reviewId: REAL_REVIEW_ID,
          name: REAL_REVIEW_RESOURCE,
          reviewer: { displayName: 'realai' },
          starRating: 'FIVE',
          comment: 'Fantastic Service',
          createTime: '2026-11-18T05:37:18.394011Z',
          updateTime: '2026-11-18T05:37:18.394011Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Never allow mock test to call publish reply
    if (urlStr.includes('/reply') && method === 'PUT') {
      observedCalls.googlePublishCalled = true
      return new Response(JSON.stringify({ comment: 'mock' }), { status: 200 })
    }

    // Mock OpenAI chat completions (must NOT be called inline during delayed enqueue)
    if (urlStr.includes('api.openai.com/v1/chat/completions')) {
      observedCalls.openAiCalled = true
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-mock-regression',
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Thank you so much, realai, for your wonderful 5-star review!',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Mock Supabase REST API
    if (urlStr.includes('.supabase.co/rest/v1/')) {
      if (urlStr.includes('/rpc/enqueue_review_reply_job')) {
        let rpcArgs: any = {}
        try {
          rpcArgs = JSON.parse(String(init?.body || '{}'))
        } catch {}
        observedCalls.enqueuedJobs.push(rpcArgs)
        return new Response(
          JSON.stringify({
            enqueued: true,
            deduplicated: false,
            reason: 'scheduled',
            job_id: 'job-uuid-regression-1',
            status: 'scheduled',
            scheduled_for: rpcArgs.p_scheduled_for,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      if (urlStr.includes('/google_connection_health')) {
        return new Response(JSON.stringify([{}]), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (urlStr.includes('/locations')) {
        if (mockMode === 'db_error') {
          return new Response(JSON.stringify({ message: 'connection reset by peer' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(
          JSON.stringify([
            {
              id: 'loc-uuid-staging-1',
              workspace_id: 'ws-uuid-staging-1',
              name: 'NexFlowOps Technologies Pvt. Ltd.',
              google_location_id: `locations/${REAL_LOCATION_ID}`,
              google_account_id: `accounts/${REAL_ACCOUNT_ID}`,
              is_connected: true,
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      if (urlStr.includes('/review_automation_events')) {
        if (method === 'GET') {
          if (mockMode === 'duplicate_event') {
            return new Response(
              JSON.stringify({
                event_id: 'msg-dup-123',
                processing_status: 'published',
                retry_count: 0,
                review_id: 'rev-db-uuid-1',
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
          }
          return new Response(JSON.stringify(null), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (method === 'POST') {
          try {
            observedCalls.recordedEvents.push(JSON.parse(String(init?.body || '{}')))
          } catch {}
          return new Response(JSON.stringify([{}]), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      }

      if (urlStr.includes('/google_integrations')) {
        return new Response(
          JSON.stringify({
            id: 'integ-1',
            workspace_id: 'ws-uuid-staging-1',
            access_token_encrypted: fakeEncryptedAccessToken,
            refresh_token_encrypted: fakeEncryptedRefreshToken,
            expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      if (urlStr.includes('/workspace_settings')) {
        // Keep manual_approval in unit mock so zero external reply publish is attempted
        return new Response(
          JSON.stringify({
            workspace_id: 'ws-uuid-staging-1',
            auto_reply_mode: 'manual_approval',
            require_approval_for_critical: true,
            default_reply_tone: 'friendly',
            business_context: 'NexFlowOps Technologies Pvt. Ltd.',
            auto_reply_min_rating: 4,
            auto_reply_delay_minutes: 5,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      if (urlStr.includes('/reviews') && !urlStr.includes('/review_replies') && !urlStr.includes('/review_reply_logs')) {
        if (method === 'GET' && urlStr.includes('external_review_id=eq.')) {
          return new Response(JSON.stringify(null), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (method === 'GET' && urlStr.includes('id=eq.')) {
          return new Response(
            JSON.stringify({
              id: 'rev-db-uuid-new',
              workspace_id: 'ws-uuid-staging-1',
              rating: 5,
              content: 'Fantastic Service',
              author_name: 'realai',
              external_review_id: REAL_REVIEW_ID,
              location_id: 'loc-uuid-staging-1',
              status: 'unanswered',
              locations: {
                name: 'NexFlowOps Technologies Pvt. Ltd.',
                google_location_id: `locations/${REAL_LOCATION_ID}`,
                google_account_id: `accounts/${REAL_ACCOUNT_ID}`,
                is_connected: true,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }
        if (method === 'POST') {
          try {
            observedCalls.upsertedReviews.push(JSON.parse(String(init?.body || '{}')))
          } catch {}
          return new Response(JSON.stringify({ id: 'rev-db-uuid-new' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      }

      if (urlStr.includes('/review_replies')) {
        if (method === 'GET') {
          return new Response(JSON.stringify(null), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(JSON.stringify({ id: 'reply-db-uuid-1' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (urlStr.includes('/review_reply_logs')) {
        return new Response(JSON.stringify([{ id: 'log-1' }]), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return originalFetch(input, init)
  }

  function makePushRequest(payload: Record<string, unknown>, messageId: string) {
    return new NextRequest(
      'http://localhost:3000/api/webhooks/google-pubsub?token=test-regression-token-xyz',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            messageId,
            publishTime: '2026-11-18T05:47:48.955Z',
            data: Buffer.from(JSON.stringify(payload)).toString('base64'),
          },
          subscription: 'projects/ai-review-manager-511010/subscriptions/gbp-review-push-staging',
        }),
      }
    )
  }

  try {
    // 2.1 Regression Test: Exact Real Google Payload ("Fantastic Service") schedules delayed job
    mockMode = 'happy'
    observedCalls.gbpFetchUrl = ''
    observedCalls.recordedEvents = []
    observedCalls.upsertedReviews = []
    observedCalls.enqueuedJobs = []
    observedCalls.openAiCalled = false
    observedCalls.googlePublishCalled = false

    const realPayloadRes = await webhookPost(
      makePushRequest(REAL_GOOGLE_NEW_REVIEW_PAYLOAD, 'msg-real-google-1')
    )
    const realPayloadBody = await realPayloadRes.json()

    assert(
      realPayloadRes.status === 200 &&
        realPayloadBody.success === true &&
        realPayloadBody.acknowledged === true &&
        realPayloadBody.queued === true &&
        realPayloadBody.delayMinutes === 5 &&
        realPayloadBody.replyStatus === 'scheduled' &&
        realPayloadBody.published === false &&
        realPayloadBody.eventType === 'NEW_REVIEW' &&
        realPayloadBody.rating === 5,
      'Suite 2',
      'Regression: Real Google payload is accepted and scheduled with 5m delay (never processed inline)',
      `Status: ${realPayloadRes.status}, Body: ${JSON.stringify(realPayloadBody)}`
    )

    assert(
      observedCalls.gbpFetchUrl ===
        `https://mybusiness.googleapis.com/v4/accounts/${REAL_ACCOUNT_ID}/locations/${REAL_LOCATION_ID}/reviews/${REAL_REVIEW_ID}`,
      'Suite 2',
      'Regression: Fetches exact review URL from Google Business Profile API',
      `Fetched URL: ${observedCalls.gbpFetchUrl}`
    )

    assert(
      observedCalls.upsertedReviews.length === 1 &&
        observedCalls.upsertedReviews[0].external_review_id === REAL_REVIEW_ID &&
        observedCalls.upsertedReviews[0].content === 'Fantastic Service',
      'Suite 2',
      'Regression: Upserts exact review into reviews table',
      `Upserted: ${JSON.stringify(observedCalls.upsertedReviews)}`
    )

    assert(
      observedCalls.enqueuedJobs.length === 1 &&
        Date.parse(observedCalls.enqueuedJobs[0].p_scheduled_for) > Date.now() + 4 * 60_000,
      'Suite 2',
      'Regression: Enqueues delayed job in review_reply_jobs ~5 minutes in the future',
      `Enqueued: ${JSON.stringify(observedCalls.enqueuedJobs)}`
    )

    assert(
      observedCalls.recordedEvents.length >= 2 &&
        observedCalls.recordedEvents[0].processing_status === 'received' &&
        observedCalls.recordedEvents[observedCalls.recordedEvents.length - 1].processing_status ===
          'scheduled',
      'Suite 2',
      'Regression: Persists initial received and scheduled state in review_automation_events',
      `Events: ${JSON.stringify(observedCalls.recordedEvents)}`
    )

    assert(
      observedCalls.openAiCalled === false && observedCalls.googlePublishCalled === false,
      'Suite 2',
      'Safety: Zero inline OpenAI generation or Google publishing during Pub/Sub webhook receipt',
      `openAiCalled=${observedCalls.openAiCalled}, googlePublishCalled=${observedCalls.googlePublishCalled}`
    )

    // 2.2 Transient DB error returns retryable HTTP 500
    mockMode = 'db_error'
    const dbErrRes = await webhookPost(
      makePushRequest(REAL_GOOGLE_NEW_REVIEW_PAYLOAD, 'msg-db-err-1')
    )
    const dbErrBody = await dbErrRes.json()
    assert(
      dbErrRes.status === 500 && dbErrBody.retryable === true,
      'Suite 2',
      'Acknowledgement safety: Transient DB error returns retryable HTTP 500',
      `Status: ${dbErrRes.status}, Body: ${JSON.stringify(dbErrBody)}`
    )

    // 2.3 Transient Google API 503 failure returns retryable HTTP 500 (not silent 200 drop)
    mockMode = 'google_503'
    const gbpErrRes = await webhookPost(
      makePushRequest(REAL_GOOGLE_NEW_REVIEW_PAYLOAD, 'msg-gbp-503-1')
    )
    const gbpErrBody = await gbpErrRes.json()
    assert(
      gbpErrRes.status === 500 && gbpErrBody.retryable === true,
      'Suite 2',
      'Acknowledgement safety: Transient Google API 503 returns retryable HTTP 500 instead of silent drop',
      `Status: ${gbpErrRes.status}, Body: ${JSON.stringify(gbpErrBody)}`
    )

    // 2.4 Duplicate Pub/Sub messageId is safely deduplicated
    mockMode = 'duplicate_event'
    observedCalls.gbpFetchUrl = ''
    const dupRes = await webhookPost(
      makePushRequest(REAL_GOOGLE_NEW_REVIEW_PAYLOAD, 'msg-dup-123')
    )
    const dupBody = await dupRes.json()
    assert(
      dupRes.status === 200 &&
        dupBody.duplicate === true &&
        dupBody.skipped === true &&
        observedCalls.gbpFetchUrl === '',
      'Suite 2',
      'Duplicate protection: Already-processed Pub/Sub messageId is skipped without redundant API calls',
      `Status: ${dupRes.status}, Body: ${JSON.stringify(dupBody)}, FetchUrl: "${observedCalls.gbpFetchUrl}"`
    )

    // 2.5 Malformed payload is handled safely without 500 retry storm
    mockMode = 'happy'
    const malformedRes = await webhookPost(
      makePushRequest({ type: 'NEW_REVIEW', location: 'bad', review: 'bad' }, 'msg-bad-1')
    )
    const malformedBody = await malformedRes.json()
    assert(
      malformedRes.status === 200 &&
        malformedBody.acknowledged === true &&
        malformedBody.ignored === true,
      'Suite 2',
      'Malformed payload safely acknowledged and ignored without retry storm',
      `Status: ${malformedRes.status}, Body: ${JSON.stringify(malformedBody)}`
    )
  } finally {
    globalThis.fetch = originalFetch
    process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN = originalToken
    if (originalAudience !== undefined) process.env.GOOGLE_PUBSUB_PUSH_AUDIENCE = originalAudience
    if (originalSA !== undefined) process.env.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT = originalSA
  }

  console.log('\n================================================================================')
  console.log('FINAL PAYLOAD & REGRESSION TEST SUMMARY')
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
    console.log(`\n🎉 ALL ${passed} PAYLOAD & REGRESSION TESTS PASSED!`)
  }
}

runPayloadTests().catch((err) => {
  console.error(err)
  process.exit(1)
})
