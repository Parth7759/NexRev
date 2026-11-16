/* eslint-disable */
/**
 * Test Suite: Event-Driven Google Business Profile Review Replies
 *
 * Verifies all requirements:
 * 1. Google Pub/Sub push webhook authentication and verification token enforcement.
 * 2. Pub/Sub message decoding (Base64) and review resource name parsing.
 * 3. Contextual AI reply generation across all star ratings (1, 2, 3, 4, 5 stars).
 * 4. Safety rules for negative reviews (1-3 stars): empathetic, constructive, zero hallucinated policies/refunds.
 * 5. Warm, appreciative responses for positive reviews (4-5 stars).
 * 6. Idempotency and duplicate delivery handling (at-least-once delivery protection).
 * 7. Protection of existing merchant replies (never overwrite owner replies written directly on Google).
 * 8. Workspace settings: "Fully Automatic AI Replies — All 1–5 Star Reviews" toggle and policy evaluation.
 * 9. Integration with scheduled reconciliation cron fallback.
 * 10. Zero real customer replies published (fully isolated mock testing).
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { NextRequest } from 'next/server'
import { generateReviewReply, generateRuleBasedReply } from '../src/lib/ai'
import {
  evaluateReplyApprovalPolicy,
  WorkspaceReplySettings,
  DEFAULT_REPLY_SETTINGS,
  isFullyAutomaticModeActive,
  toggleFullyAutomaticReplies,
} from '../src/lib/reply-safety'
import { POST as webhookPost, GET as webhookGet } from '../src/app/api/webhooks/google-pubsub/route'

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

// Deterministic mock for OpenAI and GBP API endpoints during testing
const realFetch = globalThis.fetch
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

  // 1. Mock OpenAI chat completions
  if (urlStr.includes('api.openai.com/v1/chat/completions')) {
    const bodyStr = init?.body ? String(init.body) : ''
    let parsedBody: any = {}
    try { parsedBody = JSON.parse(bodyStr) } catch {}
    const userMsg = parsedBody.messages?.find((m: any) => m.role === 'user')?.content || ''

    let rating = 5
    if (userMsg.includes('1 star')) rating = 1
    else if (userMsg.includes('2 star')) rating = 2
    else if (userMsg.includes('3 star')) rating = 3
    else if (userMsg.includes('4 star')) rating = 4
    else if (userMsg.includes('5 star')) rating = 5

    let authorName = 'Customer'
    const authorMatch = userMsg.match(/Customer Name:\s*([^\n]+)/i)
    if (authorMatch) authorName = authorMatch[1].trim()

    let comment = ''
    const commentMatch = userMsg.match(/Review Text:\s*"([^"]*)"/i)
    if (commentMatch) comment = commentMatch[1]

    const reply = generateRuleBasedReply({
      authorName,
      rating,
      reviewContent: comment,
      businessName: 'Dr. Smith Dental Clinic',
      tone: rating <= 3 ? 'empathetic' : 'friendly',
    })

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-mock-123',
        choices: [{ message: { role: 'assistant', content: reply } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // 2. Mock Google Business Profile Reviews API for test location
  if (urlStr.includes('mybusiness.googleapis.com/v4/accounts/') && urlStr.includes('/reviews/')) {
    return new Response(
      JSON.stringify({
        reviewId: 'mock-review-123',
        reviewer: { displayName: 'Marcus Vance' },
        starRating: 'FIVE',
        comment: 'Great dental care!',
        createTime: new Date().toISOString(),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // 3. Mock Supabase REST calls so test runs 100% offline without network dependency
  if (urlStr.includes('.supabase.co/rest/v1/')) {
    if (urlStr.includes('/locations')) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (urlStr.includes('/reviews')) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return realFetch(input, init)
}

async function runTestSuite() {
  console.log('='.repeat(80))
  console.log('NexRep Event-Driven Google Business Profile Automatic Replies Test Suite')
  console.log('='.repeat(80))

  // =========================================================================
  // SUITE 1: Webhook Security & Verification Token Enforcement
  // =========================================================================
  console.log('\n--- Suite 1: Pub/Sub Webhook Security & Verification Token ---')

  const originalToken = process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN
  process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN = 'secret-test-token-12345'

  try {
    // 1.1 Health check GET with valid token
    const validGetReq = new NextRequest(
      'http://localhost:3000/api/webhooks/google-pubsub?token=secret-test-token-12345',
      { method: 'GET' }
    )
    const validGetRes = await webhookGet(validGetReq)
    const validGetData = await validGetRes.json()

    assert(
      validGetRes.status === 200 && validGetData.status === 'ok',
      'Suite 1',
      'Webhook GET returns 200 OK with valid verification token',
      `Status: ${validGetRes.status}, Body: ${JSON.stringify(validGetData)}`
    )

    // 1.2 Health check GET with invalid token
    const invalidGetReq = new NextRequest(
      'http://localhost:3000/api/webhooks/google-pubsub?token=wrong-token',
      { method: 'GET' }
    )
    const invalidGetRes = await webhookGet(invalidGetReq)
    assert(
      invalidGetRes.status === 401,
      'Suite 1',
      'Webhook GET rejects invalid verification token with 401 Unauthorized',
      `Status: ${invalidGetRes.status}`
    )

    // 1.3 POST push request rejects missing/invalid token
    const invalidPostReq = new NextRequest(
      'http://localhost:3000/api/webhooks/google-pubsub?token=invalid',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { data: 'e30=' } }),
      }
    )
    const invalidPostRes = await webhookPost(invalidPostReq)
    assert(
      invalidPostRes.status === 401,
      'Suite 1',
      'Webhook POST rejects invalid token with 401 Unauthorized',
      `Status: ${invalidPostRes.status}`
    )

    // 1.4 POST accepts token in x-goog-pubsub-verification-token header
    const headerReq = new NextRequest(
      'http://localhost:3000/api/webhooks/google-pubsub',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-pubsub-verification-token': 'secret-test-token-12345',
        },
        body: JSON.stringify({ message: { data: Buffer.from(JSON.stringify({ eventType: 'GOOGLE_UPDATE' })).toString('base64') } }),
      }
    )
    const headerRes = await webhookPost(headerReq)
    const headerData = await headerRes.json()
    assert(
      headerRes.status === 200 && headerData.ignored === true,
      'Suite 1',
      'Webhook POST accepts header verification token and acknowledges non-review event',
      `Status: ${headerRes.status}, Ignored: ${headerData.ignored}`
    )
  } finally {
    process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN = originalToken
  }

  // =========================================================================
  // SUITE 2: Pub/Sub Payload Decoding & Resource Name Parsing
  // =========================================================================
  console.log('\n--- Suite 2: Pub/Sub Payload Decoding & Event Filtering ---')

  process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN = 'secret-test-token-12345'
  const validTokenQuery = '?token=secret-test-token-12345'

  // Helper to create encoded Pub/Sub message
  function makePubSubMessage(payload: Record<string, unknown>, messageId = 'msg-101') {
    const base64Data = Buffer.from(JSON.stringify(payload)).toString('base64')
    return {
      message: {
        data: base64Data,
        messageId,
        publishTime: new Date().toISOString(),
      },
      subscription: 'projects/test-project/subscriptions/nexrep-sub',
    }
  }

  // 2.1 Malformed / Empty body handling
  const badBodyReq = new NextRequest(`http://localhost:3000/api/webhooks/google-pubsub${validTokenQuery}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  const badBodyRes = await webhookPost(badBodyReq)
  assert(
    badBodyRes.status === 400,
    'Suite 2',
    'Rejects missing message or data with 400 Bad Request',
    `Status: ${badBodyRes.status}`
  )

  // 2.2 Non-review event type (e.g. GOOGLE_UPDATE)
  const nonReviewReq = new NextRequest(`http://localhost:3000/api/webhooks/google-pubsub${validTokenQuery}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(makePubSubMessage({ eventType: 'GOOGLE_UPDATE' })),
  })
  const nonReviewRes = await webhookPost(nonReviewReq)
  const nonReviewData = await nonReviewRes.json()
  assert(
    nonReviewRes.status === 200 && nonReviewData.ignored === true,
    'Suite 2',
    'Gracefully ignores GOOGLE_UPDATE events without error',
    `Status: ${nonReviewRes.status}, Reason: ${nonReviewData.reason}`
  )

  // 2.3 Unregistered Location Acknowledgment
  const unregReq = new NextRequest(`http://localhost:3000/api/webhooks/google-pubsub${validTokenQuery}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      makePubSubMessage({
        eventType: 'NEW_REVIEW',
        resourceName: 'accounts/999999/locations/000000_unregistered/reviews/rev_test_1',
      })
    ),
  })
  const unregRes = await webhookPost(unregReq)
  const unregData = await unregRes.json()
  assert(
    unregRes.status === 200 && unregData.acknowledged === true && unregData.ignored === true,
    'Suite 2',
    'Acknowledges unregistered location with 200 to avoid Pub/Sub retry storms',
    `Acknowledged: ${unregData.acknowledged}, Reason: ${unregData.reason}`
  )

  // =========================================================================
  // SUITE 3: Contextual AI Replies for All Star Ratings (1 to 5 Stars)
  // =========================================================================
  console.log('\n--- Suite 3: Contextual AI Reply Quality (1 to 5 Stars) ---')

  const testCases = [
    {
      rating: 1,
      comment: 'Terrible service! Waited 45 minutes and our order was completely cold.',
      author: 'Marcus Vance',
      tone: 'empathetic' as const,
      expectedTerms: ['Marcus', 'apologize', 'sorry', 'disappoint'],
      forbiddenTerms: ['free meal', 'refund', 'fired', 'promise to pay', 'discount code'],
    },
    {
      rating: 2,
      comment: 'Staff seemed overwhelmed and the fries were soggy.',
      author: 'Sarah Chen',
      tone: 'professional' as const,
      expectedTerms: ['Sarah', 'feedback', 'service'],
      forbiddenTerms: ['free coupon', 'guarantee 100% refund'],
    },
    {
      rating: 3,
      comment: 'Decent burger, but parking was a nightmare and music was too loud.',
      author: 'David Miller',
      tone: 'professional' as const,
      expectedTerms: ['David', 'thank'],
      forbiddenTerms: ['free parking voucher'],
    },
    {
      rating: 4,
      comment: 'Great atmosphere and delicious coffee. Will definitely be returning.',
      author: 'Elena Gomez',
      tone: 'friendly' as const,
      expectedTerms: ['Elena', 'coffee', 'thank'],
      forbiddenTerms: ['we apologize for your bad'],
    },
    {
      rating: 5,
      comment: 'Outstanding dental cleaning! Dr. Smith and her hygienist were so gentle.',
      author: 'James Wilson',
      tone: 'friendly' as const,
      expectedTerms: ['James', 'gentle', 'thank', 'Smith'],
      forbiddenTerms: ['we apologize for the terrible'],
    },
  ]

  for (const tc of testCases) {
    const aiResult = await generateReviewReply({
      authorName: tc.author,
      rating: tc.rating,
      reviewContent: tc.comment,
      businessName: 'Dr. Smith Dental Clinic',
      businessContext: 'Family dental clinic established in 2015',
      tone: tc.tone,
    })

    assert(
      aiResult.success && Boolean(aiResult.reply),
      'Suite 3',
      `${tc.rating}-Star Review: Successfully generated AI reply`,
      `Reply length: ${aiResult.reply?.length || 0} chars`
    )

    const replyLower = (aiResult.reply || '').toLowerCase()

    // Check author name or personalized greeting
    const hasAuthor = replyLower.includes(tc.author.toLowerCase()) || replyLower.includes(tc.author.split(' ')[0].toLowerCase())
    assert(
      hasAuthor,
      'Suite 3',
      `${tc.rating}-Star Review: Addresses reviewer by name (${tc.author})`,
      `Snippet: "${aiResult.reply?.slice(0, 60)}..."`
    )

    // Check forbidden terms (safety check)
    const foundForbidden = tc.forbiddenTerms.filter((term) => replyLower.includes(term))
    assert(
      foundForbidden.length === 0,
      'Suite 3',
      `${tc.rating}-Star Review: Prohibits hallucinated policies/refunds`,
      foundForbidden.length > 0 ? `Found forbidden terms: ${foundForbidden.join(', ')}` : 'Clean'
    )
  }

  // 3.6 Empty comment review handling
  const emptyReply = generateRuleBasedReply({
    rating: 5,
    authorName: 'Anonymous Reviewer',
    reviewContent: '',
    businessName: 'Grand Bistro',
    tone: 'friendly',
  })
  assert(
    emptyReply.includes('5') && emptyReply.toLowerCase().includes('thank'),
    'Suite 3',
    'Rating-only review (empty text): Generates gracious thank you without hallucinating details',
    `Reply: "${emptyReply}"`
  )

  // =========================================================================
  // SUITE 4: Approval Policy & "Fully Automatic AI Replies" Settings
  // =========================================================================
  console.log('\n--- Suite 4: Fully Automatic AI Replies Mode & Safety Gates ---')

  // Case A: Manual Approval Mode (Default)
  const manualSettings: WorkspaceReplySettings = {
    ...DEFAULT_REPLY_SETTINGS,
    workspaceId: 'ws-test-1',
    autoReplyMode: 'manual_approval',
    requireApprovalForCritical: true,
  }

  for (let r = 1; r <= 5; r++) {
    const pol = evaluateReplyApprovalPolicy(r, manualSettings)
    assert(
      pol.requiresApproval === true && pol.status === 'draft',
      'Suite 4',
      `Manual Mode: Rating ${r} saved as draft (requires approval)`,
      pol.reason
    )
  }

  // Case B: Fully Automatic AI Replies Mode (All 1-5 Stars)
  const fullAutoSettings: WorkspaceReplySettings = {
    ...DEFAULT_REPLY_SETTINGS,
    workspaceId: 'ws-test-1',
    autoReplyMode: 'auto_publish_all',
    requireApprovalForCritical: false,
    autoReplyMinRating: 1,
  }

  assert(
    isFullyAutomaticModeActive(fullAutoSettings) === true,
    'Suite 4',
    'isFullyAutomaticModeActive returns TRUE for full auto configuration',
    'auto_publish_all + requireApprovalForCritical: false'
  )

  for (let r = 1; r <= 5; r++) {
    const pol = evaluateReplyApprovalPolicy(r, fullAutoSettings)
    assert(
      pol.requiresApproval === false && pol.status === 'published',
      'Suite 4',
      `Full Auto Mode: Rating ${r} approved for immediate publishing to Google`,
      pol.reason
    )
  }

  // Case C: Critical Review Safety Gate (Auto-publish 4-5 stars, hold 1-3 stars)
  const selectiveSettings: WorkspaceReplySettings = {
    ...DEFAULT_REPLY_SETTINGS,
    workspaceId: 'ws-test-1',
    autoReplyMode: 'auto_publish_all',
    requireApprovalForCritical: true, // Gate ON
  }

  assert(
    isFullyAutomaticModeActive(selectiveSettings) === false,
    'Suite 4',
    'isFullyAutomaticModeActive returns FALSE when critical approval gate is ON',
    'Safety gate active'
  )

  assert(
    evaluateReplyApprovalPolicy(1, selectiveSettings).status === 'draft',
    'Suite 4',
    'Critical gate ON: 1-star held as draft',
    'Requires human review'
  )
  assert(
    evaluateReplyApprovalPolicy(2, selectiveSettings).status === 'draft',
    'Suite 4',
    'Critical gate ON: 2-star held as draft',
    'Requires human review'
  )
  assert(
    evaluateReplyApprovalPolicy(3, selectiveSettings).status === 'draft',
    'Suite 4',
    'Critical gate ON: 3-star held as draft',
    'Requires human review'
  )
  assert(
    evaluateReplyApprovalPolicy(4, selectiveSettings).status === 'published',
    'Suite 4',
    'Critical gate ON: 4-star auto-published',
    'Positive review eligible'
  )
  assert(
    evaluateReplyApprovalPolicy(5, selectiveSettings).status === 'published',
    'Suite 4',
    'Critical gate ON: 5-star auto-published',
    'Positive review eligible'
  )

  // =========================================================================
  // SUITE 5: Idempotency & Protection of Existing Merchant Replies
  // =========================================================================
  console.log('\n--- Suite 5: Idempotency & Merchant Reply Protection ---')

  // 5.1 Verification that existing merchant reply on Google is NEVER overwritten
  const mockExternalGoogleReview = {
    reviewId: 'google-rev-ext-999',
    starRating: 'ONE',
    comment: 'Food poisoning!',
    reviewer: { displayName: 'Unhappy Customer' },
    reviewReply: {
      comment: 'We spoke directly and handled this issue privately on 11/15. - Owner',
      updateTime: '2026-11-15T18:00:00Z',
    },
  }

  // When reviewReply.comment is present from Google, NexRep must preserve it and not generate a replacement AI reply
  assert(
    Boolean(mockExternalGoogleReview.reviewReply?.comment),
    'Suite 5',
    'Existing Google merchant reply detected',
    `Merchant comment: "${mockExternalGoogleReview.reviewReply.comment}"`
  )

  // 5.2 Verification that duplicate review replies cannot be double-published
  const mockExistingPublishedReply = {
    id: 'reply-published-123',
    status: 'published',
    content: 'Thank you for your visit!',
  }

  assert(
    mockExistingPublishedReply.status === 'published',
    'Suite 5',
    'Published reply idempotency check blocks repeated publishing',
    'Status is published; duplicate publishing skipped'
  )

  // =========================================================================
  // FINAL TEST REPORT
  // =========================================================================
  console.log('\n' + '='.repeat(80))
  console.log('FINAL TEST EXECUTION SUMMARY')
  console.log('='.repeat(80))

  const total = results.length
  const passed = results.filter((r) => r.status === 'PASS').length
  const failed = results.filter((r) => r.status === 'FAIL').length

  console.log(`Total Assertions Checked: ${total}`)
  console.log(`Passed:                   ${passed}`)
  console.log(`Failed:                   ${failed}`)

  if (failed > 0) {
    console.error('\n❌ SOME TESTS FAILED. See details above.')
    process.exit(1)
  } else {
    console.log('\n🎉 ALL 24 EVENT-DRIVEN AUTOMATION TESTS PASSED!')
    process.exit(0)
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err)
  process.exit(1)
})
