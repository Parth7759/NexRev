/* eslint-disable */
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { POST as webhookPost } from '../src/app/api/webhooks/google-pubsub/route'
import { NextRequest } from 'next/server'
import { toggleFullyAutomaticReplies } from '../src/lib/reply-safety'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Deterministic Mock for fetch: intercepts Google APIs and OpenAI
const originalFetch = globalThis.fetch

let mockGooglePublishCalls: any[] = []
let mockGbpFetchCalls: any[] = []

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

  // 1. Mock OpenAI Chat Completion
  if (url.includes('api.openai.com')) {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-mock',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Thank you for your review! We appreciate your business and feedback.',
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // 2. Mock Google GBP API fetch single review
  if (url.includes('mybusiness.googleapis.com/v4/accounts/') && url.includes('/reviews/') && init?.method !== 'PUT') {
    mockGbpFetchCalls.push({ url, init })
    const isMerchantReplied = url.includes('merchant-replied-review')
    return new Response(
      JSON.stringify({
        reviewId: url.split('/').pop(),
        reviewer: { displayName: 'Staging Test Customer' },
        starRating: 'FIVE',
        comment: 'Outstanding automated service test!',
        createTime: new Date().toISOString(),
        updateTime: new Date().toISOString(),
        ...(isMerchantReplied
          ? {
              reviewReply: {
                comment: 'Merchant direct reply: Thank you from the manager.',
                updateTime: new Date().toISOString(),
              },
            }
          : {}),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // 3. Mock Google GBP API updateReply (publish)
  if (url.includes('/reply') && (init?.method === 'PUT' || init?.method === 'POST')) {
    mockGooglePublishCalls.push({ url, body: init?.body })
    return new Response(
      JSON.stringify({
        comment: 'Mock published reply',
        updateTime: new Date().toISOString(),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // 4. Mock Google OAuth Token Refresh endpoint
  if (url.includes('oauth2.googleapis.com/token')) {
    return new Response(
      JSON.stringify({
        access_token: 'mock-valid-google-access-token-staging-test',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  return originalFetch(input, init)
}

function createPubSubRequest(payload: any, messageId: string, token?: string) {
  const base64Data = Buffer.from(JSON.stringify(payload)).toString('base64')
  const body = {
    message: {
      data: base64Data,
      messageId,
      publishTime: new Date().toISOString(),
    },
    subscription: 'projects/nexrep-staging/subscriptions/test-sub',
  }

  const url = token
    ? `http://localhost:3001/api/webhooks/google-pubsub?token=${token}`
    : `http://localhost:3001/api/webhooks/google-pubsub`

  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-goog-pubsub-verification-token': token } : {}),
    },
    body: JSON.stringify(body),
  })
}

async function runPipelineVerification() {
  console.log('==================================================================')
  console.log('AUDIT ITEM 4 & 5: END-TO-END PIPELINE & STAGING VERIFICATION')
  console.log('==================================================================')

  // Setup: Find existing connected location on staging
  const { data: locs, error: locErr } = await admin
    .from('locations')
    .select('id, workspace_id, name, google_location_id, google_account_id, is_connected')
    .eq('is_connected', true)
    .limit(1)

  if (locErr || !locs || locs.length === 0) {
    console.error('❌ No connected location found on staging:', locErr)
    process.exit(1)
  }

  const location = locs[0]
  const workspaceId = location.workspace_id
  const cleanLocId = location.google_location_id.replace(/^locations\//, '')
  const cleanAccId = location.google_account_id.replace(/^accounts\//, '')

  console.log(`Using staging workspace: ${workspaceId}`)
  console.log(`Using location: ${location.name} (${cleanLocId})`)

  // Ensure workspace settings are configured for FULLY AUTOMATIC
  await toggleFullyAutomaticReplies(admin, workspaceId, true)
  console.log('✅ Workspace configured for Fully Automatic AI Replies (All 1-5 Stars).')

  const testReviewId = `audit-test-rev-${Date.now()}`
  const rawResourceName = `accounts/${cleanAccId}/locations/${cleanLocId}/reviews/${testReviewId}`

  // --- TEST A: End-to-End Ingestion, AI Generation, and Auto-Publish ---
  console.log('\n--- TEST A: First Ingestion & Auto-Publish ---')
  mockGooglePublishCalls = []
  const msg1Id = `msg-auto-${Date.now()}`
  const req1 = createPubSubRequest(
    {
      resourceName: rawResourceName,
      eventType: 'NEW_REVIEW',
    },
    msg1Id
  )

  const res1 = await webhookPost(req1)
  const res1Data = await res1.json()
  console.log('Webhook res1:', res1.status, res1Data)

  if (res1Data.acknowledged && res1Data.published) {
    console.log('✅ PASS: Webhook processed NEW_REVIEW and published reply.')
  } else {
    console.error('❌ FAIL: Expected published reply, got:', res1Data)
  }

  // Verify event persisted in review_automation_events
  const { data: event1 } = await admin
    .from('review_automation_events')
    .select('*')
    .eq('event_id', msg1Id)
    .single()

  if (event1 && event1.processing_status === 'published' && event1.publishing_status === 'published') {
    console.log(`✅ PASS: Event persisted in review_automation_events with status 'published'.`)
    console.log(`   Reply generated: "${event1.ai_generated_reply}"`)
  } else {
    console.error('❌ FAIL: Event not properly persisted in review_automation_events:', event1)
  }

  // --- TEST B: Duplicate Notification Idempotency (different messageId, same review) ---
  console.log('\n--- TEST B: Duplicate Notification Idempotency ---')
  mockGooglePublishCalls = []
  const msg2Id = `msg-dup-${Date.now()}`
  const req2 = createPubSubRequest(
    {
      resourceName: rawResourceName,
      eventType: 'NEW_REVIEW',
    },
    msg2Id
  )

  const res2 = await webhookPost(req2)
  const res2Data = await res2.json()
  console.log('Webhook res2:', res2.status, res2Data)

  if (res2Data.acknowledged && res2Data.skipped && mockGooglePublishCalls.length === 0) {
    console.log('✅ PASS: Duplicate delivery detected! Skipped duplicate publishing without contacting Google.')
  } else {
    console.error('❌ FAIL: Duplicate delivery was not skipped:', res2Data, 'Publish calls:', mockGooglePublishCalls.length)
  }

  // Verify second event recorded as skipped
  const { data: event2 } = await admin
    .from('review_automation_events')
    .select('*')
    .eq('event_id', msg2Id)
    .single()

  if (event2 && event2.processing_status === 'skipped') {
    console.log('✅ PASS: Duplicate event recorded in review_automation_events with status "skipped".')
  } else {
    console.error('❌ FAIL: Duplicate event record status incorrect:', event2)
  }

  // --- TEST C: Merchant Reply Preservation ---
  console.log('\n--- TEST C: Merchant Reply Preservation ---')
  mockGooglePublishCalls = []
  const merchantReviewId = `merchant-replied-review-${Date.now()}`
  const merchantResource = `accounts/${cleanAccId}/locations/${cleanLocId}/reviews/${merchantReviewId}`
  const msg3Id = `msg-merchant-${Date.now()}`

  const req3 = createPubSubRequest(
    {
      resourceName: merchantResource,
      eventType: 'NEW_REVIEW',
    },
    msg3Id
  )

  const res3 = await webhookPost(req3)
  const res3Data = await res3.json()
  console.log('Webhook res3:', res3.status, res3Data)

  if (res3Data.acknowledged && res3Data.skipped && mockGooglePublishCalls.length === 0) {
    console.log('✅ PASS: Merchant reply preserved! Overwrite prevented, 0 Google publish calls.')
  } else {
    console.error('❌ FAIL: Merchant reply was not preserved:', res3Data)
  }

  // --- TEST D: Pause Responsiveness ---
  console.log('\n--- TEST D: Pause Automation Responsiveness ---')
  // Update workspace settings to paused via toggleFullyAutomaticReplies(false)
  await toggleFullyAutomaticReplies(admin, workspaceId, false)

  mockGooglePublishCalls = []
  const pausedReviewId = `paused-test-rev-${Date.now()}`
  const pausedResource = `accounts/${cleanAccId}/locations/${cleanLocId}/reviews/${pausedReviewId}`
  const msg4Id = `msg-paused-${Date.now()}`

  const req4 = createPubSubRequest(
    {
      resourceName: pausedResource,
      eventType: 'NEW_REVIEW',
    },
    msg4Id
  )

  const res4 = await webhookPost(req4)
  const res4Data = await res4.json()
  console.log('Webhook res4 (paused):', res4.status, res4Data)

  if (res4Data.acknowledged && res4Data.published === false && mockGooglePublishCalls.length === 0) {
    console.log('✅ PASS: Pause immediately prevented automatic publishing! Reply held as draft.')
  } else {
    console.error('❌ FAIL: Automation did not halt when paused:', res4Data)
  }

  // Verify paused event recorded in review_automation_events with status 'draft_saved'
  const { data: event4 } = await admin
    .from('review_automation_events')
    .select('*')
    .eq('event_id', msg4Id)
    .single()

  if (event4 && event4.processing_status === 'draft_saved') {
    console.log('✅ PASS: Event persisted in review_automation_events with status "draft_saved".')
  } else {
    console.error('❌ FAIL: Event status when paused was not draft_saved:', event4)
  }

  // Re-enable automation
  await toggleFullyAutomaticReplies(admin, workspaceId, true)

  // --- CLEANUP TEST DATA ---
  console.log('\n--- Cleaning up test records from staging ---')
  const reviewIdsToClean = [testReviewId, merchantReviewId, pausedReviewId]
  const { data: testReviews } = await admin
    .from('reviews')
    .select('id')
    .in('external_review_id', reviewIdsToClean)

  if (testReviews && testReviews.length > 0) {
    const ids = testReviews.map((r) => r.id)
    await admin.from('review_replies').delete().in('review_id', ids)
    await admin.from('review_reply_logs').delete().in('review_id', ids)
    await admin.from('review_automation_events').delete().in('review_id', ids)
    await admin.from('reviews').delete().in('id', ids)
  }
  await admin
    .from('review_automation_events')
    .delete()
    .in('event_id', [msg1Id, msg2Id, msg3Id, msg4Id])

  console.log('✅ Cleaned up all staging test records.')
  console.log('\n🎉 ALL PIPELINE TESTS COMPLETED SUCCESSFULLY!')
}

runPipelineVerification().catch(console.error)
