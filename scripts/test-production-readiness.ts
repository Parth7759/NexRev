import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { resolveBusinessIdentity, sanitizeBusinessContext } from '@/lib/business-identity'
import { buildReviewReplyPrompts, generateRuleBasedReply } from '@/lib/ai'
import {
  DEFAULT_REPLY_SETTINGS,
  detectSensitiveReviewContent,
  evaluateReplyApprovalPolicy,
  WorkspaceReplySettings,
} from '@/lib/reply-safety'
import { runScheduledReplyWorker, ReviewReplyJobRow } from '@/lib/reply-queue'
import { getTokenEncryptionReadiness } from '@/lib/encryption'

let passed = 0
let failed = 0

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    console.log(`  PASS  ${name}`)
    passed++
  } catch (err: unknown) {
    console.error(`  FAIL  ${name}`)
    console.error('       ', err instanceof Error ? err.message : err)
    failed++
  }
}

async function run() {
  console.log('\n=== NexRep Production Launch Readiness Offline Regression Suite ===\n')

  // ---------------------------------------------------------------------------
  // 1. Dynamic Per-Workspace / Per-Location Business Identity
  // ---------------------------------------------------------------------------
  console.log('1. Dynamic Business Identity & Context Hygiene')

  await test('NexFlowOps location with stale NexRep seed context resolves to NexFlowOps and strips platform seed', () => {
    const prompts = buildReviewReplyPrompts({
      authorName: 'Meraki For men',
      rating: 5,
      reviewContent: 'Very Good Service,Helpful',
      locationName: 'NexFlowOps Technologies Pvt. Ltd.',
      workspaceName: "Parth's Workspace",
      businessContext: 'NexRep is a premium customer reputation management platform.',
      tone: 'friendly',
    })

    assert.equal(prompts.identity.businessName, 'NexFlowOps Technologies Pvt. Ltd.')
    assert.equal(prompts.identity.branchLabel, undefined)
    assert.equal(prompts.identity.businessContext, undefined)
    assert.equal(prompts.identity.isPlatformNamedBusiness, false)
    assert.ok(prompts.systemPrompt.includes('representing "NexFlowOps Technologies Pvt. Ltd."'))
    assert.ok(!prompts.systemPrompt.includes('at our NexFlowOps Technologies Pvt. Ltd. location'))
    assert.ok(prompts.systemPrompt.includes('NEVER refer to "NexRep"'))
    assert.ok(!prompts.userMessage.includes('NexRep is a premium'))
    assert.ok(prompts.userMessage.includes('Business Name: NexFlowOps Technologies Pvt. Ltd.'))

    const ruleReply = generateRuleBasedReply({
      authorName: 'Meraki For men',
      rating: 5,
      reviewContent: 'Very Good Service,Helpful',
      locationName: 'NexFlowOps Technologies Pvt. Ltd.',
      workspaceName: "Parth's Workspace",
      businessContext: 'NexRep is a premium customer reputation management platform.',
      tone: 'friendly',
    })
    assert.ok(ruleReply.includes('NexFlowOps Technologies Pvt. Ltd.'))
    assert.ok(!/nexrep/i.test(ruleReply))
  })

  await test('Different customer workspace resolves dynamically to its own business name & genuine context (zero hardcoding)', () => {
    const prompts = buildReviewReplyPrompts({
      authorName: 'Sarah',
      rating: 5,
      reviewContent: 'Dr. Patel was super gentle with my kids!',
      locationName: 'Downtown Dental Clinic',
      workspaceName: 'Downtown Dental Group',
      businessContext: 'Family-owned pediatric and cosmetic dental clinic open Mon-Sat since 2012.',
      tone: 'friendly',
    })

    assert.equal(prompts.identity.businessName, 'Downtown Dental Clinic')
    assert.equal(
      prompts.identity.businessContext,
      'Family-owned pediatric and cosmetic dental clinic open Mon-Sat since 2012.'
    )
    assert.ok(prompts.systemPrompt.includes('representing "Downtown Dental Clinic"'))
    assert.ok(prompts.userMessage.includes('Family-owned pediatric and cosmetic dental clinic'))
    assert.ok(!/nexflowops/i.test(prompts.systemPrompt))
    assert.ok(!/nexflowops/i.test(prompts.userMessage))

    const ruleReply = generateRuleBasedReply({
      authorName: 'Sarah',
      rating: 5,
      reviewContent: 'Dr. Patel was super gentle with my kids!',
      locationName: 'Downtown Dental Clinic',
      businessContext: 'Family-owned pediatric and cosmetic dental clinic open Mon-Sat since 2012.',
      tone: 'friendly',
    })
    assert.ok(ruleReply.includes('Downtown Dental Clinic'))
    assert.ok(!/nexflowops|nexrep/i.test(ruleReply))
  })

  await test('Multi-branch brand with distinct businessName and locationName keeps branchLabel without duplication', () => {
    const identity = resolveBusinessIdentity({
      businessName: 'Blue Bottle Coffee',
      locationName: 'SoHo',
      businessContext: 'Specialty pour-over coffee bar.',
    })
    assert.equal(identity.businessName, 'Blue Bottle Coffee')
    assert.equal(identity.branchLabel, 'SoHo')

    const sameIdentity = resolveBusinessIdentity({
      businessName: 'Acme Bakery',
      locationName: 'Acme Bakery',
    })
    assert.equal(sameIdentity.businessName, 'Acme Bakery')
    assert.equal(sameIdentity.branchLabel, undefined)
  })

  await test('Falls back to non-generic workspaceName when locationName is missing and NEVER promotes businessContext', () => {
    const identity = resolveBusinessIdentity({
      locationName: undefined,
      workspaceName: 'Sunrise Wellness Studio',
      businessContext: 'Boutique yoga and physiotherapy studio in Austin.',
    })
    assert.equal(identity.businessName, 'Sunrise Wellness Studio')
    assert.equal(identity.hasExplicitBusinessName, true)
    assert.equal(identity.businessContext, 'Boutique yoga and physiotherapy studio in Austin.')
  })

  await test('Skips generic auto-generated workspace name and uses neutral fallback without leaking context into businessName', () => {
    const identity = resolveBusinessIdentity({
      locationName: '',
      workspaceName: "Parth's Workspace",
      businessContext: 'Custom cloud consulting services.',
    })
    assert.equal(identity.businessName, 'our business')
    assert.equal(identity.hasExplicitBusinessName, false)
    assert.equal(identity.businessContext, 'Custom cloud consulting services.')
  })

  await test('Strips embedded config comment and preserves custom context lines when mixed with legacy seed text', () => {
    const cleaned = sanitizeBusinessContext(
      'NexRep is a premium customer reputation management platform.\nWe specialize in AI workflow automation.\n<!--nexrep-config:{"negativeReviewAlertsEnabled":true}-->',
      'NexFlowOps Technologies Pvt. Ltd.'
    )
    assert.equal(cleaned, 'We specialize in AI workflow automation.')
  })

  await test('Preserves NexRep branding if a customer business is genuinely named NexRep', () => {
    const identity = resolveBusinessIdentity({
      locationName: 'NexRep Studio',
      businessContext: 'NexRep is a premium customer reputation management platform.',
    })
    assert.equal(identity.isPlatformNamedBusiness, true)
    assert.equal(identity.businessName, 'NexRep Studio')
    assert.equal(
      identity.businessContext,
      'NexRep is a premium customer reputation management platform.'
    )
  })

  // ---------------------------------------------------------------------------
  // 2. 1-3 Star & Sensitive Review Safety Gates
  // ---------------------------------------------------------------------------
  console.log('\n2. 1-3 Star & Sensitive Review Safety Gates')

  const recommendedProdSettings: WorkspaceReplySettings = {
    workspaceId: 'ws-test',
    ...DEFAULT_REPLY_SETTINGS,
    autoReplyMode: 'auto_publish_positive',
    requireApprovalForCritical: true,
    autoReplyMinRating: 4,
  }

  const fullAutoSettings: WorkspaceReplySettings = {
    workspaceId: 'ws-test',
    ...DEFAULT_REPLY_SETTINGS,
    autoReplyMode: 'auto_publish_all',
    requireApprovalForCritical: false,
    autoReplyMinRating: 1,
  }

  await test('Recommended production policy auto-publishes clean 4-5 star reviews and holds 1-3 star reviews as drafts', () => {
    const r5 = evaluateReplyApprovalPolicy(5, recommendedProdSettings, 'Very Good Service,Helpful')
    assert.equal(r5.requiresApproval, false)
    assert.equal(r5.status, 'published')

    const r4 = evaluateReplyApprovalPolicy(4, recommendedProdSettings, 'Good experience, quick turnaround.')
    assert.equal(r4.requiresApproval, false)
    assert.equal(r4.status, 'published')

    for (const star of [3, 2, 1]) {
      const res = evaluateReplyApprovalPolicy(star, recommendedProdSettings, 'Service was slow.')
      assert.equal(res.requiresApproval, true, `Expected ${star}-star review to require approval`)
      assert.equal(res.status, 'draft')
    }
  })

  await test('Sensitive 4-5 star reviews are ALWAYS routed to manual approval draft (even under full auto)', () => {
    const cases: Array<{ text: string; rating: number; expectedCategory: string }> = [
      { text: 'Great food, but I am contacting my lawyer about a lawsuit.', rating: 5, expectedCategory: 'legal_threat' },
      { text: 'Looks good initially, total scam and unauthorized charge on my card.', rating: 5, expectedCategory: 'fraud_or_billing' },
      { text: 'Nice ambiance but gave me food poisoning last night.', rating: 4, expectedCategory: 'health_or_safety' },
      { text: 'Good location, though staff harassment was unacceptable.', rating: 4, expectedCategory: 'harassment_or_discrimination' },
      { text: 'Fast service, worried after hearing about a data breach.', rating: 5, expectedCategory: 'privacy_or_compliance' },
    ]

    for (const c of cases) {
      const detection = detectSensitiveReviewContent(c.text)
      assert.equal(detection.isSensitive, true, `Expected sensitive match for: ${c.text}`)
      assert.equal(detection.category, c.expectedCategory)

      const policyPos = evaluateReplyApprovalPolicy(c.rating, recommendedProdSettings, c.text)
      assert.equal(policyPos.requiresApproval, true)
      assert.equal(policyPos.status, 'draft')

      const policyFull = evaluateReplyApprovalPolicy(c.rating, fullAutoSettings, c.text)
      assert.equal(policyFull.requiresApproval, true)
      assert.equal(policyFull.status, 'draft')
    }
  })

  await test('Normal positive reviews do NOT trigger false positives in sensitive content detector', () => {
    const benignReviews = [
      'Very Good Service,Helpful',
      'Great experience working with this team. Very professional and responsive.',
      'Friendly staff, quick service, fair pricing!',
      '',
    ]
    for (const text of benignReviews) {
      assert.equal(detectSensitiveReviewContent(text).isSensitive, false, `False positive on: ${text}`)
    }
  })

  // ---------------------------------------------------------------------------
  // 3. Worker Retry Hardening & Lock Release on Unexpected Errors
  // ---------------------------------------------------------------------------
  console.log('\n3. Worker Retry Hardening & Lock Release')

  await test('Unexpected error during claimed job releases lock and schedules exponential retry (attempts < max_attempts)', async () => {
    const updates: Array<Record<string, unknown>> = []
    const claimedJob: ReviewReplyJobRow = {
      id: 'job-err-1',
      workspace_id: 'ws-1',
      location_id: 'loc-1',
      review_id: 'rev-1',
      external_review_id: 'ext-1',
      source_event_id: 'evt-1',
      source_event_type: 'NEW_REVIEW',
      status: 'processing',
      scheduled_for: '2026-11-18T08:00:00.000Z',
      locked_at: '2026-11-18T08:05:00.000Z',
      locked_by: 'worker-test',
      attempts: 2,
      max_attempts: 5,
      next_retry_at: null,
      last_error: null,
      processed_at: null,
      metadata: {},
      created_at: '2026-11-18T07:55:00.000Z',
      updated_at: '2026-11-18T08:05:00.000Z',
    }

    const mockSupabase = {
      rpc: async (fnName: string) => {
        if (fnName === 'claim_due_review_reply_jobs') {
          return { data: [claimedJob], error: null }
        }
        return { data: null, error: null }
      },
      from: (table: string) => {
        if (table === 'automation_worker_runs') {
          return {
            insert: () => ({
              select: () => ({ single: async () => ({ data: { id: 'run-1' }, error: null }) }),
            }),
            update: () => ({ eq: async () => ({ error: null }) }),
          }
        }
        if (table === 'locations') {
          // Force unexpected thrown exception during live pre-check
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  throw new Error('Simulated DB connection reset')
                },
              }),
            }),
          }
        }
        if (table === 'review_replies') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'review_reply_jobs') {
          return {
            update: (payload: Record<string, unknown>) => {
              updates.push(payload)
              return { eq: async () => ({ error: null }) }
            },
          }
        }
        if (table === 'review_automation_events') {
          return {
            update: () => ({ eq: async () => ({ error: null }) }),
          }
        }
        return {
          select: () => ({ eq: async () => ({ data: [], error: null }) }),
        }
      },
    }

    const summary = await runScheduledReplyWorker(mockSupabase as never, {
      workerId: 'worker-test',
      triggerSource: 'supabase_cron',
      skipHealthProbe: true,
      nowMs: Date.parse('2026-11-18T08:06:00.000Z'),
    })

    assert.equal(summary.failed, 1)
    assert.equal(summary.deadLettered, 0)
    assert.equal(updates.length, 1)
    assert.equal(updates[0].status, 'failed')
    assert.equal(updates[0].locked_at, null)
    assert.equal(updates[0].locked_by, null)
    assert.ok(typeof updates[0].next_retry_at === 'string')
    assert.equal(updates[0].last_error, 'Simulated DB connection reset')
  })

  await test('Unexpected error on final attempt transitions immediately to dead_letter and clears lock', async () => {
    const updates: Array<Record<string, unknown>> = []
    const claimedJob: ReviewReplyJobRow = {
      id: 'job-err-final',
      workspace_id: 'ws-1',
      location_id: 'loc-1',
      review_id: 'rev-1',
      external_review_id: 'ext-1',
      source_event_id: 'evt-1',
      source_event_type: 'NEW_REVIEW',
      status: 'processing',
      scheduled_for: '2026-11-18T08:00:00.000Z',
      locked_at: '2026-11-18T08:05:00.000Z',
      locked_by: 'worker-test',
      attempts: 5,
      max_attempts: 5,
      next_retry_at: null,
      last_error: null,
      processed_at: null,
      metadata: {},
      created_at: '2026-11-18T07:55:00.000Z',
      updated_at: '2026-11-18T08:05:00.000Z',
    }

    const mockSupabase = {
      rpc: async () => ({ data: [claimedJob], error: null }),
      from: (table: string) => {
        if (table === 'automation_worker_runs') {
          return {
            insert: () => ({
              select: () => ({ single: async () => ({ data: { id: 'run-2' }, error: null }) }),
            }),
            update: () => ({ eq: async () => ({ error: null }) }),
          }
        }
        if (table === 'locations') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  throw new Error('Fatal runtime error on final attempt')
                },
              }),
            }),
          }
        }
        if (table === 'review_replies') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'review_reply_jobs') {
          return {
            update: (payload: Record<string, unknown>) => {
              updates.push(payload)
              return { eq: async () => ({ error: null }) }
            },
          }
        }
        if (table === 'review_automation_events') {
          return {
            update: () => ({ eq: async () => ({ error: null }) }),
          }
        }
        return { select: () => ({ eq: async () => ({ data: [], error: null }) }) }
      },
    }

    const summary = await runScheduledReplyWorker(mockSupabase as never, {
      workerId: 'worker-test',
      triggerSource: 'supabase_cron',
      skipHealthProbe: true,
      nowMs: Date.parse('2026-11-18T08:06:00.000Z'),
    })

    assert.equal(summary.failed, 1)
    assert.equal(summary.deadLettered, 1)
    assert.equal(updates.length, 1)
    assert.equal(updates[0].status, 'dead_letter')
    assert.equal(updates[0].locked_at, null)
    assert.equal(updates[0].locked_by, null)
    assert.equal(updates[0].next_retry_at, null)
    assert.ok(typeof updates[0].processed_at === 'string')
  })

  // ---------------------------------------------------------------------------
  // 4. Production OAuth & Cron Config Guards
  // ---------------------------------------------------------------------------
  console.log('\n4. Production OAuth & Cron Config Guards')

  await test('getTokenEncryptionReadiness detects dedicated 32+ char key vs fallback safely', () => {
    const original = process.env.TOKEN_ENCRYPTION_KEY
    try {
      delete process.env.TOKEN_ENCRYPTION_KEY
      const missing = getTokenEncryptionReadiness()
      assert.equal(missing.dedicatedKeyConfigured, false)
      assert.equal(missing.usingFallback, true)

      process.env.TOKEN_ENCRYPTION_KEY = 'short-key'
      const weak = getTokenEncryptionReadiness()
      assert.equal(weak.dedicatedKeyConfigured, false)
      assert.equal(weak.usingFallback, false)

      process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64)
      const strong = getTokenEncryptionReadiness()
      assert.equal(strong.dedicatedKeyConfigured, true)
      assert.equal(strong.usingFallback, false)
    } finally {
      if (original === undefined) delete process.env.TOKEN_ENCRYPTION_KEY
      else process.env.TOKEN_ENCRYPTION_KEY = original
    }
  })

  await test('vercel.json disables legacy daily direct-bypass cron in production', () => {
    const raw = fs.readFileSync(path.resolve(process.cwd(), 'vercel.json'), 'utf8')
    const parsed = JSON.parse(raw)
    assert.ok(Array.isArray(parsed.crons))
    assert.equal(parsed.crons.length, 0)
  })

  await test('Public OAuth verification legal routes (/privacy-policy and /terms) both exist', () => {
    assert.equal(
      fs.existsSync(path.resolve(process.cwd(), 'src/app/privacy-policy/page.tsx')),
      true
    )
    assert.equal(fs.existsSync(path.resolve(process.cwd(), 'src/app/terms/page.tsx')), true)
  })

  console.log(`\nSummary: ${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
}

run().catch((err) => {
  console.error('Fatal test suite error:', err)
  process.exit(1)
})

