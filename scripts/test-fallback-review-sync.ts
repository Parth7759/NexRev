import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { encryptToken } from '@/lib/encryption'
import { fetchGoogleReviews } from '@/lib/google-business'
import {
  syncWorkspaceGoogleReviews,
  syncWorkspaceGoogleReviewsFallback,
  runPeriodicGoogleReviewFallbackSync,
  extractLastFallbackSyncRunAt,
} from '@/lib/google-review-sync'
import {
  recordGoogleConnectionHealth,
  runScheduledReplyWorker,
} from '@/lib/reply-queue'
import {
  evaluateReplyApprovalPolicy,
  WorkspaceReplySettings,
} from '@/lib/reply-safety'

interface LocationRow {
  id: string
  workspace_id: string
  name: string
  google_account_id: string | null
  google_location_id: string | null
  is_connected: boolean
  updated_at: string
}

interface IntegrationRow {
  id: string
  workspace_id: string
  account_id: string | null
  account_name: string | null
  access_token_encrypted: string
  refresh_token_encrypted: string
  expires_at: string
  scope: string
  updated_at: string
}

interface ReviewRow {
  id: string
  workspace_id: string
  location_id: string
  author_name: string
  author_photo_url: string | null
  rating: number
  content: string
  review_date: string
  source: string
  status: string
  sentiment: string
  external_review_id: string
  updated_at?: string
}

interface ReplyRow {
  id: string
  review_id: string
  workspace_id: string
  content: string
  is_ai_generated: boolean
  status: string
  updated_at?: string
}

interface JobRow {
  id: string
  workspace_id: string
  location_id: string
  review_id: string
  external_review_id: string
  source_event_id: string
  source_event_type: string
  status: string
  scheduled_for: string
  max_attempts: number
  metadata: Record<string, unknown>
}

interface EventRow {
  event_id: string
  review_resource_id: string
  workspace_id: string
  location_id: string
  review_id: string
  event_type: string
  processing_status: string
  publishing_status: string
  error_message: string | null
  metadata: Record<string, unknown>
}

interface HealthRow {
  workspace_id: string
  status: string
  metadata: Record<string, unknown>
  last_checked_at?: string | null
  updated_at?: string
}

interface WorkspaceSettingsRow {
  workspace_id: string
  auto_reply_mode: 'manual_approval' | 'auto_publish_positive' | 'auto_publish_all'
  require_approval_for_critical: boolean
  default_reply_tone: 'professional' | 'friendly' | 'concise' | 'empathetic'
  business_context: string
  auto_reply_min_rating: number
  auto_reply_delay_minutes: number
}

interface InMemoryDb {
  locations: LocationRow[]
  google_integrations: IntegrationRow[]
  reviews: ReviewRow[]
  review_replies: ReplyRow[]
  review_reply_jobs: JobRow[]
  review_automation_events: EventRow[]
  google_connection_health: HealthRow[]
  workspace_settings: WorkspaceSettingsRow[]
  deleteCalls: string[]
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>
  simulateReviewRace23505For?: Set<string>
}

function createInMemoryDb(partial?: Partial<InMemoryDb>): InMemoryDb {
  return {
    locations: [],
    google_integrations: [],
    reviews: [],
    review_replies: [],
    review_reply_jobs: [],
    review_automation_events: [],
    google_connection_health: [],
    workspace_settings: [],
    deleteCalls: [],
    rpcCalls: [],
    ...partial,
  }
}

function buildMockSupabase(db: InMemoryDb) {
  function getTableRows(table: string): Array<Record<string, unknown>> {
    switch (table) {
      case 'locations':
        return db.locations as unknown as Array<Record<string, unknown>>
      case 'google_integrations':
        return db.google_integrations as unknown as Array<Record<string, unknown>>
      case 'reviews':
        return db.reviews as unknown as Array<Record<string, unknown>>
      case 'review_replies':
        return db.review_replies as unknown as Array<Record<string, unknown>>
      case 'review_reply_jobs':
        return db.review_reply_jobs as unknown as Array<Record<string, unknown>>
      case 'review_automation_events':
        return db.review_automation_events as unknown as Array<Record<string, unknown>>
      case 'google_connection_health':
        return db.google_connection_health as unknown as Array<Record<string, unknown>>
      case 'workspace_settings':
        return db.workspace_settings as unknown as Array<Record<string, unknown>>
      default:
        return []
    }
  }

  return {
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = []

      const applyFilters = (rows: Array<Record<string, unknown>>) =>
        rows.filter((row) => filters.every((fn) => fn(row)))

      const selectBuilder = {
        eq(col: string, val: unknown) {
          filters.push((r) => r[col] === val)
          return selectBuilder
        },
        in(col: string, vals: unknown[]) {
          const set = new Set(vals)
          filters.push((r) => set.has(r[col]))
          return selectBuilder
        },
        order() {
          return selectBuilder
        },
        limit() {
          return selectBuilder
        },
        async maybeSingle() {
          const matched = applyFilters(getTableRows(table))
          return { data: matched[0] ?? null, error: null }
        },
        async single() {
          const matched = applyFilters(getTableRows(table))
          return {
            data: matched[0] ?? null,
            error: matched[0] ? null : { message: 'Row not found' },
          }
        },
        then(resolve: (value: { data: unknown[]; error: null }) => void) {
          resolve({ data: applyFilters(getTableRows(table)), error: null })
        },
      }

      return {
        select() {
          return selectBuilder
        },
        insert(payload: Record<string, unknown>) {
          const rows = getTableRows(table)

          // Simulate concurrent unique violation 23505 when configured for a review ID
          if (
            table === 'reviews' &&
            typeof payload.external_review_id === 'string' &&
            db.simulateReviewRace23505For?.has(payload.external_review_id)
          ) {
            db.simulateReviewRace23505For.delete(payload.external_review_id)
            const racedId = `rev-raced-${crypto.randomBytes(4).toString('hex')}`
            rows.push({
              id: racedId,
              ...payload,
            })
            return {
              select: () => ({
                single: async () => ({
                  data: null,
                  error: { code: '23505', message: 'duplicate key value violates unique constraint' },
                }),
              }),
              then(resolve: (v: { data: null; error: { code: string; message: string } }) => void) {
                resolve({
                  data: null,
                  error: { code: '23505', message: 'duplicate key value violates unique constraint' },
                })
              },
            }
          }

          const inserted = {
            id: (payload.id as string) || `${table}-${crypto.randomBytes(4).toString('hex')}`,
            ...payload,
          }
          rows.push(inserted)

          return {
            select: () => ({
              single: async () => ({ data: inserted, error: null }),
              maybeSingle: async () => ({ data: inserted, error: null }),
            }),
            then(resolve: (v: { data: Record<string, unknown>; error: null }) => void) {
              resolve({ data: inserted, error: null })
            },
          }
        },
        update(patch: Record<string, unknown>) {
          const updateFilters: Array<(row: Record<string, unknown>) => boolean> = []
          const updateBuilder = {
            eq(col: string, val: unknown) {
              updateFilters.push((r) => r[col] === val)
              return updateBuilder
            },
            then(resolve: (v: { data: null; error: null }) => void) {
              const rows = getTableRows(table)
              for (const row of rows) {
                if (updateFilters.every((fn) => fn(row))) {
                  Object.assign(row, patch)
                }
              }
              resolve({ data: null, error: null })
            },
          }
          return updateBuilder
        },
        upsert(payload: Record<string, unknown>, opts?: { onConflict?: string }) {
          const rows = getTableRows(table)
          const conflictCol = opts?.onConflict || 'id'
          const existing = rows.find((r) => r[conflictCol] === payload[conflictCol])
          if (existing) {
            Object.assign(existing, payload)
          } else {
            rows.push({ ...payload })
          }
          return Promise.resolve({ data: payload, error: null })
        },
        delete() {
          db.deleteCalls.push(table)
          return {
            eq() {
              return Promise.resolve({ data: null, error: null })
            },
          }
        },
      }
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      db.rpcCalls.push({ fn, args })

      if (fn === 'enqueue_review_reply_job') {
        const reviewId = args.p_review_id as string
        const workspaceId = args.p_workspace_id as string

        const hasPublishedOrDraft = db.review_replies.some(
          (r) => r.review_id === reviewId && r.workspace_id === workspaceId
        )
        if (hasPublishedOrDraft) {
          return {
            data: {
              enqueued: false,
              deduplicated: true,
              reason: 'already_published',
              job_id: null,
              status: 'skipped',
              scheduled_for: null,
            },
            error: null,
          }
        }

        const openJob = db.review_reply_jobs.find(
          (j) =>
            j.review_id === reviewId &&
            ['scheduled', 'processing', 'failed'].includes(j.status)
        )
        if (openJob) {
          return {
            data: {
              enqueued: false,
              deduplicated: true,
              reason: 'existing_open_job',
              job_id: openJob.id,
              status: openJob.status,
              scheduled_for: openJob.scheduled_for,
            },
            error: null,
          }
        }

        const newJob: JobRow = {
          id: `job-${crypto.randomBytes(4).toString('hex')}`,
          workspace_id: workspaceId,
          location_id: args.p_location_id as string,
          review_id: reviewId,
          external_review_id: args.p_external_review_id as string,
          source_event_id: args.p_source_event_id as string,
          source_event_type: args.p_source_event_type as string,
          status: 'scheduled',
          scheduled_for: args.p_scheduled_for as string,
          max_attempts: (args.p_max_attempts as number) ?? 5,
          metadata: (args.p_metadata as Record<string, unknown>) || {},
        }
        db.review_reply_jobs.push(newJob)

        return {
          data: {
            enqueued: true,
            deduplicated: false,
            reason: 'scheduled',
            job_id: newJob.id,
            status: 'scheduled',
            scheduled_for: newJob.scheduled_for,
          },
          error: null,
        }
      }

      if (fn === 'claim_due_review_reply_jobs') {
        return { data: [], error: null }
      }

      return { data: null, error: null }
    },
  }
}

let passed = 0
let failed = 0

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    passed++
    console.log(`  PASS  ${name}`)
  } catch (err) {
    failed++
    console.error(`  FAIL  ${name}`)
    console.error(err)
  }
}

async function run() {
  console.log('\n=== NexRep Queue-Safe Periodic Fallback Review Sync Regression Suite ===\n')

  const originalKey = process.env.TOKEN_ENCRYPTION_KEY
  const originalClientId = process.env.GOOGLE_CLIENT_ID
  const originalClientSecret = process.env.GOOGLE_CLIENT_SECRET
  const originalFetch = globalThis.fetch

  // Deterministic 32-byte hex key for AES-256-GCM encryption in offline tests
  process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  process.env.GOOGLE_CLIENT_ID = 'test-client-id'
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'

  const NOW_MS = Date.parse('2026-11-18T11:00:00.000Z')
  const FUTURE_EXPIRY = new Date(NOW_MS + 3600_000).toISOString()

  try {
    // -----------------------------------------------------------------------
    // 1. Missed Pub/Sub notification recovery + 5m delayed queue (no direct publish)
    // -----------------------------------------------------------------------
    await test('1. Missed Pub/Sub review is imported and enqueued with 5m delay (never directly published)', async () => {
      const db = createInMemoryDb({
        locations: [
          {
            id: 'loc-1',
            workspace_id: 'ws-1',
            name: 'NexFlowOps Technologies',
            google_account_id: 'accounts/1001',
            google_location_id: 'locations/2001',
            is_connected: true,
            updated_at: '2026-11-16T10:00:00.000Z',
          },
        ],
        google_integrations: [
          {
            id: 'int-1',
            workspace_id: 'ws-1',
            account_id: 'accounts/1001',
            account_name: 'NexFlowOps',
            access_token_encrypted: encryptToken('token-ws-1'),
            refresh_token_encrypted: encryptToken('refresh-ws-1'),
            expires_at: FUTURE_EXPIRY,
            scope: 'https://www.googleapis.com/auth/business.manage',
            updated_at: '2026-11-16T10:00:00.000Z',
          },
        ],
        workspace_settings: [
          {
            workspace_id: 'ws-1',
            auto_reply_mode: 'auto_publish_positive',
            require_approval_for_critical: true,
            default_reply_tone: 'friendly',
            business_context: '',
            auto_reply_min_rating: 4,
            auto_reply_delay_minutes: 5,
          },
        ],
      })

      const fetchedRequests: Array<{ url: string; method: string; auth: string | null }> = []
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method || 'GET'
        const headers = init?.headers as Record<string, string> | undefined
        fetchedRequests.push({ url, method, auth: headers?.Authorization || null })

        assert.ok(
          !url.includes('/reply') && !url.includes('openai.com'),
          'Fallback sync must NEVER call GBP reply publish or OpenAI directly'
        )

        return new Response(
          JSON.stringify({
            reviews: [
              {
                reviewId: 'rev-missed-nisarg',
                reviewer: { displayName: 'Nisarg Mehta' },
                starRating: 'FIVE',
                comment: 'Great tech solutions and super quick service!',
                createTime: '2026-11-18T10:28:26.453Z',
                updateTime: '2026-11-18T10:28:26.453Z',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }) as typeof fetch

      const supabase = buildMockSupabase(db)
      const res = await syncWorkspaceGoogleReviewsFallback(supabase as never, 'ws-1', {
        nowMs: NOW_MS,
      })

      assert.equal(res.success, true)
      assert.equal(res.fetched, 1)
      assert.equal(res.inserted, 1)
      assert.equal(res.updated, 0)
      assert.equal(res.skipped, 0)
      assert.equal(res.enqueued, 1)
      assert.equal(res.failed, 0)
      assert.equal(db.reviews.length, 1)
      assert.equal(db.reviews[0].external_review_id, 'rev-missed-nisarg')
      assert.equal(db.reviews[0].status, 'unanswered')
      assert.equal(db.review_replies.length, 0)
      assert.equal(db.review_reply_jobs.length, 1)
      assert.equal(db.review_reply_jobs[0].source_event_type, 'SYNC_RECONCILIATION')
      assert.equal(
        db.review_reply_jobs[0].scheduled_for,
        new Date(NOW_MS + 5 * 60_000).toISOString()
      )
      assert.equal(db.review_automation_events.length, 1)
      assert.equal(db.review_automation_events[0].event_type, 'SYNC_RECONCILIATION')
      assert.equal(db.review_automation_events[0].processing_status, 'scheduled')
      assert.equal(db.deleteCalls.length, 0)
      assert.equal(fetchedRequests.length, 1)
      assert.equal(fetchedRequests[0].method, 'GET')
      assert.equal(fetchedRequests[0].auth, 'Bearer token-ws-1')
    })

    // -----------------------------------------------------------------------
    // 2. Duplicate import idempotency (re-run inserts 0 duplicates, enqueues 0 jobs)
    // -----------------------------------------------------------------------
    await test('2. Re-running fallback sync is strictly idempotent (zero duplicate reviews or jobs)', async () => {
      const db = createInMemoryDb({
        locations: [
          {
            id: 'loc-1',
            workspace_id: 'ws-1',
            name: 'NexFlowOps',
            google_account_id: 'accounts/1001',
            google_location_id: 'locations/2001',
            is_connected: true,
            updated_at: '2026-11-18T10:00:00.000Z',
          },
        ],
        google_integrations: [
          {
            id: 'int-1',
            workspace_id: 'ws-1',
            account_id: 'accounts/1001',
            account_name: 'NexFlowOps',
            access_token_encrypted: encryptToken('token-ws-1'),
            refresh_token_encrypted: encryptToken('refresh-ws-1'),
            expires_at: FUTURE_EXPIRY,
            scope: 'https://www.googleapis.com/auth/business.manage',
            updated_at: '2026-11-18T10:00:00.000Z',
          },
        ],
      })

      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            reviews: [
              {
                reviewId: 'rev-dup-1',
                reviewer: { displayName: 'Customer One' },
                starRating: 'FIVE',
                comment: 'Awesome experience',
                createTime: '2026-11-18T10:30:00.000Z',
                updateTime: '2026-11-18T10:30:00.000Z',
              },
            ],
          }),
          { status: 200 }
        )) as typeof fetch

      const supabase = buildMockSupabase(db)
      const first = await syncWorkspaceGoogleReviewsFallback(supabase as never, 'ws-1', {
        nowMs: NOW_MS,
      })
      const second = await syncWorkspaceGoogleReviewsFallback(supabase as never, 'ws-1', {
        nowMs: NOW_MS + 11 * 60_000,
      })

      assert.equal(first.inserted, 1)
      assert.equal(first.enqueued, 1)
      assert.equal(second.inserted, 0)
      assert.equal(second.updated, 0)
      assert.equal(second.skipped, 1)
      assert.equal(second.enqueued, 0)
      assert.equal(db.reviews.length, 1)
      assert.equal(db.review_reply_jobs.length, 1)
    })

    // -----------------------------------------------------------------------
    // 3. Concurrent insert race (23505 unique constraint) handled safely
    // -----------------------------------------------------------------------
    await test('3. Concurrent insert race (PostgreSQL 23505) is handled idempotently without failure', async () => {
      const db = createInMemoryDb({
        locations: [
          {
            id: 'loc-1',
            workspace_id: 'ws-1',
            name: 'NexFlowOps',
            google_account_id: 'accounts/1001',
            google_location_id: 'locations/2001',
            is_connected: true,
            updated_at: '2026-11-18T10:00:00.000Z',
          },
        ],
        google_integrations: [
          {
            id: 'int-1',
            workspace_id: 'ws-1',
            account_id: 'accounts/1001',
            account_name: 'NexFlowOps',
            access_token_encrypted: encryptToken('token-ws-1'),
            refresh_token_encrypted: encryptToken('refresh-ws-1'),
            expires_at: FUTURE_EXPIRY,
            scope: 'https://www.googleapis.com/auth/business.manage',
            updated_at: '2026-11-18T10:00:00.000Z',
          },
        ],
        simulateReviewRace23505For: new Set(['rev-race-1']),
      })

      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            reviews: [
              {
                reviewId: 'rev-race-1',
                reviewer: { displayName: 'Race Reviewer' },
                starRating: 'FIVE',
                comment: 'Simultaneous webhook + fallback',
                createTime: '2026-11-18T10:55:00.000Z',
                updateTime: '2026-11-18T10:55:00.000Z',
              },
            ],
          }),
          { status: 200 }
        )) as typeof fetch

      const supabase = buildMockSupabase(db)
      const res = await syncWorkspaceGoogleReviewsFallback(supabase as never, 'ws-1', {
        nowMs: NOW_MS,
      })

      assert.equal(res.success, true)
      assert.equal(res.failed, 0)
      assert.equal(res.skipped, 1)
      assert.equal(res.enqueued, 0)
      assert.equal(db.reviews.length, 1)
    })

    // -----------------------------------------------------------------------
    // 4. Initial / backfill sync uses skipAutoReply=true (zero jobs, zero publishes)
    // -----------------------------------------------------------------------
    await test('4. Initial/backfill sync (skipAutoReply=true & default syncWorkspaceGoogleReviews) never enqueues or publishes', async () => {
      const db = createInMemoryDb({
        locations: [
          {
            id: 'loc-1',
            workspace_id: 'ws-1',
            name: 'NexFlowOps',
            google_account_id: 'accounts/1001',
            google_location_id: 'locations/2001',
            is_connected: true,
            updated_at: '2026-11-18T10:00:00.000Z',
          },
        ],
        google_integrations: [
          {
            id: 'int-1',
            workspace_id: 'ws-1',
            account_id: 'accounts/1001',
            account_name: 'NexFlowOps',
            access_token_encrypted: encryptToken('token-ws-1'),
            refresh_token_encrypted: encryptToken('refresh-ws-1'),
            expires_at: FUTURE_EXPIRY,
            scope: 'https://www.googleapis.com/auth/business.manage',
            updated_at: '2026-11-18T10:00:00.000Z',
          },
        ],
      })

      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            reviews: [
              {
                reviewId: 'rev-backfill-1',
                reviewer: { displayName: 'Backfill Customer' },
                starRating: 'FIVE',
                comment: 'Great service!',
                createTime: '2026-11-18T10:40:00.000Z',
                updateTime: '2026-11-18T10:40:00.000Z',
              },
            ],
          }),
          { status: 200 }
        )) as typeof fetch

      const supabase = buildMockSupabase(db)

      // 4a. Fallback sync with skipAutoReply: true
      const fallbackRes = await syncWorkspaceGoogleReviewsFallback(supabase as never, 'ws-1', {
        skipAutoReply: true,
        nowMs: NOW_MS,
      })
      assert.equal(fallbackRes.inserted, 1)
      assert.equal(fallbackRes.enqueued, 0)
      assert.equal(db.review_reply_jobs.length, 0)
      assert.equal(db.review_replies.length, 0)

      // 4b. Default syncWorkspaceGoogleReviews (no options -> skipAutoReply defaults to true)
      db.reviews.length = 0
      const fullSyncRes = await syncWorkspaceGoogleReviews(supabase as never, 'ws-1')
      assert.equal(fullSyncRes.success, true)
      assert.equal(fullSyncRes.newReviewsCount, 1)
      assert.equal(db.review_reply_jobs.length, 0)
      assert.equal(db.review_replies.length, 0)
    })

    // -----------------------------------------------------------------------
    // 5. Never delete historical reviews + never enqueue old unanswered reviews
    // -----------------------------------------------------------------------
    await test('5. Historical reviews missing from Google are NEVER deleted, and old unanswered reviews are NEVER enqueued', async () => {
      const db = createInMemoryDb({
        locations: [
          {
            id: 'loc-1',
            workspace_id: 'ws-1',
            name: 'NexFlowOps',
            google_account_id: 'accounts/1001',
            google_location_id: 'locations/2001',
            is_connected: true,
            updated_at: '2026-11-16T10:00:00.000Z',
          },
        ],
        google_integrations: [
          {
            id: 'int-1',
            workspace_id: 'ws-1',
            account_id: 'accounts/1001',
            account_name: 'NexFlowOps',
            access_token_encrypted: encryptToken('token-ws-1'),
            refresh_token_encrypted: encryptToken('refresh-ws-1'),
            expires_at: FUTURE_EXPIRY,
            scope: 'https://www.googleapis.com/auth/business.manage',
            updated_at: '2026-11-16T10:00:00.000Z',
          },
        ],
        reviews: [
          {
            id: 'rev-hist-hidden',
            workspace_id: 'ws-1',
            location_id: 'loc-1',
            author_name: 'Meraki For men',
            author_photo_url: null,
            rating: 5,
            content: 'Temporarily absent from Google API',
            review_date: '2026-11-18T08:00:00.000Z',
            source: 'google',
            status: 'answered',
            sentiment: 'positive',
            external_review_id: 'rev-meraki-absent',
          },
          {
            id: 'rev-old-unanswered',
            workspace_id: 'ws-1',
            location_id: 'loc-1',
            author_name: 'realai',
            author_photo_url: null,
            rating: 5,
            content: 'Old review from weeks ago',
            review_date: '2026-10-01T10:00:00.000Z',
            source: 'google',
            status: 'unanswered',
            sentiment: 'positive',
            external_review_id: 'rev-realai-old',
          },
        ],
      })

      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            reviews: [
              // Only an old review older than 24h returned by Google; Meraki is omitted
              {
                reviewId: 'rev-brand-new-but-old-date',
                reviewer: { displayName: 'Historical Customer' },
                starRating: 'FIVE',
                comment: 'Posted 30 days ago',
                createTime: '2026-10-15T10:00:00.000Z',
                updateTime: '2026-10-15T10:00:00.000Z',
              },
            ],
          }),
          { status: 200 }
        )) as typeof fetch

      const supabase = buildMockSupabase(db)
      const res = await syncWorkspaceGoogleReviewsFallback(supabase as never, 'ws-1', {
        lookbackHours: 24,
        nowMs: NOW_MS,
      })

      assert.equal(res.success, true)
      assert.equal(res.fetched, 0) // Filtered out by 24h lookback cutoff
      assert.equal(res.truncatedByLookback, true)
      assert.equal(res.enqueued, 0)
      assert.equal(db.deleteCalls.length, 0)
      assert.equal(db.reviews.length, 2) // Both Meraki and realai preserved intact!
      assert.equal(db.review_reply_jobs.length, 0) // Zero jobs enqueued for old reviews!
    })

    // -----------------------------------------------------------------------
    // 6. Existing merchant reply on Google synced as answered without AI job
    // -----------------------------------------------------------------------
    await test('6. Review with existing merchant reply on Google is synced as answered with zero AI job enqueued', async () => {
      const db = createInMemoryDb({
        locations: [
          {
            id: 'loc-1',
            workspace_id: 'ws-1',
            name: 'NexFlowOps',
            google_account_id: 'accounts/1001',
            google_location_id: 'locations/2001',
            is_connected: true,
            updated_at: '2026-11-18T10:00:00.000Z',
          },
        ],
        google_integrations: [
          {
            id: 'int-1',
            workspace_id: 'ws-1',
            account_id: 'accounts/1001',
            account_name: 'NexFlowOps',
            access_token_encrypted: encryptToken('token-ws-1'),
            refresh_token_encrypted: encryptToken('refresh-ws-1'),
            expires_at: FUTURE_EXPIRY,
            scope: 'https://www.googleapis.com/auth/business.manage',
            updated_at: '2026-11-18T10:00:00.000Z',
          },
        ],
      })

      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            reviews: [
              {
                reviewId: 'rev-merchant-replied',
                reviewer: { displayName: 'Direct Reply Customer' },
                starRating: 'FIVE',
                comment: 'Loved the team!',
                createTime: '2026-11-18T10:45:00.000Z',
                updateTime: '2026-11-18T10:45:00.000Z',
                reviewReply: {
                  comment: 'Thank you so much for visiting us!',
                  updateTime: '2026-11-18T10:46:00.000Z',
                },
              },
            ],
          }),
          { status: 200 }
        )) as typeof fetch

      const supabase = buildMockSupabase(db)
      const res = await syncWorkspaceGoogleReviewsFallback(supabase as never, 'ws-1', {
        nowMs: NOW_MS,
      })

      assert.equal(res.inserted, 1)
      assert.equal(res.enqueued, 0)
      assert.equal(db.reviews[0].status, 'answered')
      assert.equal(db.review_replies.length, 1)
      assert.equal(db.review_replies[0].content, 'Thank you so much for visiting us!')
      assert.equal(db.review_replies[0].is_ai_generated, false)
      assert.equal(db.review_reply_jobs.length, 0)
    })

    // -----------------------------------------------------------------------
    // 7. Bounded pagination + early stop on lookback cutoff
    // -----------------------------------------------------------------------
    await test('7. Pagination fetches multiple pages via nextPageToken and stops early once past lookback cutoff', async () => {
      const pageCalls: string[] = []
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = new URL(String(input))
        const token = url.searchParams.get('pageToken') || 'page1'
        pageCalls.push(token)

        if (token === 'page1') {
          return new Response(
            JSON.stringify({
              reviews: [
                {
                  reviewId: 'rev-p1-1',
                  reviewer: { displayName: 'P1 User' },
                  starRating: 'FIVE',
                  comment: 'Recent page 1',
                  createTime: '2026-11-18T10:50:00.000Z',
                  updateTime: '2026-11-18T10:50:00.000Z',
                },
              ],
              nextPageToken: 'page2',
            }),
            { status: 200 }
          )
        }

        if (token === 'page2') {
          return new Response(
            JSON.stringify({
              reviews: [
                {
                  reviewId: 'rev-p2-recent',
                  reviewer: { displayName: 'P2 Recent' },
                  starRating: 'FOUR',
                  comment: 'Still within 24h',
                  createTime: '2026-11-18T01:00:00.000Z',
                  updateTime: '2026-11-18T01:00:00.000Z',
                },
                {
                  reviewId: 'rev-p2-old',
                  reviewer: { displayName: 'P2 Old' },
                  starRating: 'FIVE',
                  comment: 'Older than 24h cutoff',
                  createTime: '2026-11-16T01:00:00.000Z',
                  updateTime: '2026-11-16T01:00:00.000Z',
                },
              ],
              nextPageToken: 'page3-should-not-fetch',
            }),
            { status: 200 }
          )
        }

        throw new Error(`Unexpected page fetch: ${token}`)
      }) as typeof fetch

      const cutoff = new Date(NOW_MS - 24 * 3600_000).toISOString()
      const result = await fetchGoogleReviews('tok', 'accounts/1', 'locations/2', {
        maxPages: 5,
        pageSize: 50,
        stopBeforeIso: cutoff,
        filterToLookback: true,
      })

      assert.equal(result.supported, true)
      assert.deepEqual(pageCalls, ['page1', 'page2']) // Stopped early before page 3!
      assert.equal(result.pagesFetched, 2)
      assert.equal(result.truncatedByLookback, true)
      assert.equal(result.truncatedByMaxPages, false)
      assert.deepEqual(
        result.reviews.map((r) => r.reviewId),
        ['rev-p1-1', 'rev-p2-recent']
      )
    })

    // -----------------------------------------------------------------------
    // 8. Multi-tenant strict isolation (tokens, accounts, locations, reviews)
    // -----------------------------------------------------------------------
    await test('8. Multiple workspaces maintain strict token and review isolation', async () => {
      const db = createInMemoryDb({
        locations: [
          {
            id: 'loc-A',
            workspace_id: 'ws-A',
            name: 'Business Alpha',
            google_account_id: 'accounts/AAA',
            google_location_id: 'locations/LOC_A',
            is_connected: true,
            updated_at: '2026-11-18T09:00:00.000Z',
          },
          {
            id: 'loc-B',
            workspace_id: 'ws-B',
            name: 'Business Beta',
            google_account_id: 'accounts/BBB',
            google_location_id: 'locations/LOC_B',
            is_connected: true,
            updated_at: '2026-11-18T09:00:00.000Z',
          },
        ],
        google_integrations: [
          {
            id: 'int-A',
            workspace_id: 'ws-A',
            account_id: 'accounts/AAA',
            account_name: 'Alpha',
            access_token_encrypted: encryptToken('secret-token-ALPHA'),
            refresh_token_encrypted: encryptToken('refresh-ALPHA'),
            expires_at: FUTURE_EXPIRY,
            scope: 'https://www.googleapis.com/auth/business.manage',
            updated_at: '2026-11-18T09:00:00.000Z',
          },
          {
            id: 'int-B',
            workspace_id: 'ws-B',
            account_id: 'accounts/BBB',
            account_name: 'Beta',
            access_token_encrypted: encryptToken('secret-token-BETA'),
            refresh_token_encrypted: encryptToken('refresh-BETA'),
            expires_at: FUTURE_EXPIRY,
            scope: 'https://www.googleapis.com/auth/business.manage',
            updated_at: '2026-11-18T09:00:00.000Z',
          },
        ],
      })

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const auth = (init?.headers as Record<string, string> | undefined)?.Authorization

        if (url.includes('accounts/AAA/locations/LOC_A')) {
          assert.equal(auth, 'Bearer secret-token-ALPHA', 'Workspace A must only use token A')
          return new Response(
            JSON.stringify({
              reviews: [
                {
                  reviewId: 'rev-alpha-1',
                  reviewer: { displayName: 'Alpha Customer' },
                  starRating: 'FIVE',
                  comment: 'Alpha review',
                  createTime: '2026-11-18T10:50:00.000Z',
                  updateTime: '2026-11-18T10:50:00.000Z',
                },
              ],
            }),
            { status: 200 }
          )
        }

        if (url.includes('accounts/BBB/locations/LOC_B')) {
          assert.equal(auth, 'Bearer secret-token-BETA', 'Workspace B must only use token B')
          return new Response(
            JSON.stringify({
              reviews: [
                {
                  reviewId: 'rev-beta-1',
                  reviewer: { displayName: 'Beta Customer' },
                  starRating: 'FOUR',
                  comment: 'Beta review',
                  createTime: '2026-11-18T10:52:00.000Z',
                  updateTime: '2026-11-18T10:52:00.000Z',
                },
              ],
            }),
            { status: 200 }
          )
        }

        throw new Error(`Unexpected cross-tenant URL: ${url}`)
      }) as typeof fetch

      const supabase = buildMockSupabase(db)
      const batch = await runPeriodicGoogleReviewFallbackSync(supabase as never, {
        nowMs: NOW_MS,
      })

      assert.equal(batch.success, true)
      assert.equal(batch.workspacesScanned, 2)
      assert.equal(batch.workspacesSynced, 2)
      assert.equal(batch.inserted, 2)
      assert.equal(batch.enqueued, 2)

      const wsAReviews = db.reviews.filter((r) => r.workspace_id === 'ws-A')
      const wsBReviews = db.reviews.filter((r) => r.workspace_id === 'ws-B')
      assert.equal(wsAReviews.length, 1)
      assert.equal(wsAReviews[0].external_review_id, 'rev-alpha-1')
      assert.equal(wsAReviews[0].location_id, 'loc-A')
      assert.equal(wsBReviews.length, 1)
      assert.equal(wsBReviews[0].external_review_id, 'rev-beta-1')
      assert.equal(wsBReviews[0].location_id, 'loc-B')
    })

    // -----------------------------------------------------------------------
    // 9. API error isolation (429 on ws-A does not block ws-B; secrets sanitized)
    // -----------------------------------------------------------------------
    await test('9. Google API 429/503 error on one workspace is isolated and never blocks healthy workspaces', async () => {
      const db = createInMemoryDb({
        locations: [
          {
            id: 'loc-fail',
            workspace_id: 'ws-fail',
            name: 'Rate Limited Biz',
            google_account_id: 'accounts/FAIL',
            google_location_id: 'locations/LOC_FAIL',
            is_connected: true,
            updated_at: '2026-11-18T08:00:00.000Z',
          },
          {
            id: 'loc-ok',
            workspace_id: 'ws-ok',
            name: 'Healthy Biz',
            google_account_id: 'accounts/OK',
            google_location_id: 'locations/LOC_OK',
            is_connected: true,
            updated_at: '2026-11-18T08:00:00.000Z',
          },
        ],
        google_integrations: [
          {
            id: 'int-fail',
            workspace_id: 'ws-fail',
            account_id: 'accounts/FAIL',
            account_name: 'Fail',
            access_token_encrypted: encryptToken('tok-fail'),
            refresh_token_encrypted: encryptToken('ref-fail'),
            expires_at: FUTURE_EXPIRY,
            scope: 'https://www.googleapis.com/auth/business.manage',
            updated_at: '2026-11-18T08:00:00.000Z',
          },
          {
            id: 'int-ok',
            workspace_id: 'ws-ok',
            account_id: 'accounts/OK',
            account_name: 'Ok',
            access_token_encrypted: encryptToken('tok-ok'),
            refresh_token_encrypted: encryptToken('ref-ok'),
            expires_at: FUTURE_EXPIRY,
            scope: 'https://www.googleapis.com/auth/business.manage',
            updated_at: '2026-11-18T08:00:00.000Z',
          },
        ],
      })

      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('accounts/FAIL')) {
          return new Response(
            JSON.stringify({ error: { message: 'Quota exceeded for ya29.secret_leak_check' } }),
            { status: 429 }
          )
        }
        return new Response(
          JSON.stringify({
            reviews: [
              {
                reviewId: 'rev-healthy-1',
                reviewer: { displayName: 'Healthy User' },
                starRating: 'FIVE',
                comment: 'Great!',
                createTime: '2026-11-18T10:55:00.000Z',
                updateTime: '2026-11-18T10:55:00.000Z',
              },
            ],
          }),
          { status: 200 }
        )
      }) as typeof fetch

      const supabase = buildMockSupabase(db)
      const batch = await runPeriodicGoogleReviewFallbackSync(supabase as never, {
        nowMs: NOW_MS,
      })

      assert.equal(batch.success, false)
      assert.equal(batch.workspacesSynced, 1)
      assert.equal(batch.workspacesFailed, 1)
      assert.equal(batch.inserted, 1)
      assert.equal(batch.enqueued, 1)
      assert.equal(batch.errors.length, 1)
      assert.equal(batch.errors[0].workspaceId, 'ws-fail')
      assert.equal(batch.errors[0].errorCode, 'QUOTA_EXCEEDED')
      assert.ok(!batch.errors[0].error.includes('ya29.secret_leak_check'))

      // Failure still records lastRunAt so 10m backoff is respected
      const failHealth = db.google_connection_health.find((h) => h.workspace_id === 'ws-fail')
      assert.ok(failHealth)
      assert.equal(
        extractLastFallbackSyncRunAt(failHealth.metadata),
        new Date(NOW_MS).toISOString()
      )
    })

    // -----------------------------------------------------------------------
    // 10. 401 INVALID_GRANT triggers single automatic forceRefresh retry
    // -----------------------------------------------------------------------
    await test('10. 401 INVALID_GRANT on reviews fetch triggers single forceRefresh retry and succeeds', async () => {
      const db = createInMemoryDb({
        locations: [
          {
            id: 'loc-1',
            workspace_id: 'ws-1',
            name: 'Retry Biz',
            google_account_id: 'accounts/1001',
            google_location_id: 'locations/2001',
            is_connected: true,
            updated_at: '2026-11-18T08:00:00.000Z',
          },
        ],
        google_integrations: [
          {
            id: 'int-1',
            workspace_id: 'ws-1',
            account_id: 'accounts/1001',
            account_name: 'Retry Biz',
            access_token_encrypted: encryptToken('stale-access-token'),
            refresh_token_encrypted: encryptToken('valid-refresh-token'),
            expires_at: FUTURE_EXPIRY,
            scope: 'https://www.googleapis.com/auth/business.manage',
            updated_at: '2026-11-18T08:00:00.000Z',
          },
        ],
      })

      let reviewsAttempts = 0
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({ access_token: 'fresh-access-token', expires_in: 3600 }),
            { status: 200 }
          )
        }
        reviewsAttempts++
        const auth = (init?.headers as Record<string, string> | undefined)?.Authorization
        if (auth === 'Bearer stale-access-token') {
          return new Response(JSON.stringify({ error: { message: 'Invalid Credentials' } }), {
            status: 401,
          })
        }
        assert.equal(auth, 'Bearer fresh-access-token')
        return new Response(
          JSON.stringify({
            reviews: [
              {
                reviewId: 'rev-after-refresh',
                reviewer: { displayName: 'Post Refresh' },
                starRating: 'FIVE',
                comment: 'Recovered after 401!',
                createTime: '2026-11-18T10:58:00.000Z',
                updateTime: '2026-11-18T10:58:00.000Z',
              },
            ],
          }),
          { status: 200 }
        )
      }) as typeof fetch

      const supabase = buildMockSupabase(db)
      const res = await syncWorkspaceGoogleReviewsFallback(supabase as never, 'ws-1', {
        nowMs: NOW_MS,
      })

      assert.equal(res.success, true)
      assert.equal(reviewsAttempts, 2)
      assert.equal(res.inserted, 1)
      assert.equal(res.enqueued, 1)
    })

    // -----------------------------------------------------------------------
    // 11. Throttling every 10 minutes + health probe metadata preservation
    // -----------------------------------------------------------------------
    await test('11. Per-workspace 10-minute throttling skips recent runs and survives health probe metadata updates', async () => {
      const db = createInMemoryDb({
        locations: [
          {
            id: 'loc-1',
            workspace_id: 'ws-1',
            name: 'Throttled Biz',
            google_account_id: 'accounts/1001',
            google_location_id: 'locations/2001',
            is_connected: true,
            updated_at: '2026-11-18T08:00:00.000Z',
          },
        ],
        google_integrations: [
          {
            id: 'int-1',
            workspace_id: 'ws-1',
            account_id: 'accounts/1001',
            account_name: 'Throttled Biz',
            access_token_encrypted: encryptToken('tok-1'),
            refresh_token_encrypted: encryptToken('ref-1'),
            expires_at: FUTURE_EXPIRY,
            scope: 'https://www.googleapis.com/auth/business.manage',
            updated_at: '2026-11-18T08:00:00.000Z',
          },
        ],
      })

      let apiCalls = 0
      globalThis.fetch = (async () => {
        apiCalls++
        return new Response(JSON.stringify({ reviews: [] }), { status: 200 })
      }) as typeof fetch

      const supabase = buildMockSupabase(db)

      // T = 0: first run executes
      const run1 = await runPeriodicGoogleReviewFallbackSync(supabase as never, {
        intervalMinutes: 10,
        nowMs: NOW_MS,
      })
      assert.equal(run1.workspacesSynced, 1)
      assert.equal(run1.workspacesThrottled, 0)
      assert.equal(apiCalls, 1)

      // Health probe updates google_connection_health.metadata -> MUST NOT wipe fallbackReviewSync!
      await recordGoogleConnectionHealth(supabase as never, 'ws-1', {
        status: 'connected_verified',
        tokenStored: true,
        hasRequiredScope: true,
        metadata: { probedEndpoint: 'notificationSetting' },
      })

      // T = +5m: must be throttled (0 API calls)
      const run2 = await runPeriodicGoogleReviewFallbackSync(supabase as never, {
        intervalMinutes: 10,
        nowMs: NOW_MS + 5 * 60_000,
      })
      assert.equal(run2.workspacesSynced, 0)
      assert.equal(run2.workspacesThrottled, 1)
      assert.equal(apiCalls, 1)

      // Verify probe metadata AND fallbackReviewSync metadata both coexist
      const healthRow = db.google_connection_health.find((h) => h.workspace_id === 'ws-1')
      assert.equal(healthRow?.metadata.probedEndpoint, 'notificationSetting')
      assert.ok(extractLastFallbackSyncRunAt(healthRow?.metadata))

      // T = +10m: now due again -> executes
      const run3 = await runPeriodicGoogleReviewFallbackSync(supabase as never, {
        intervalMinutes: 10,
        nowMs: NOW_MS + 10 * 60_000,
      })
      assert.equal(run3.workspacesSynced, 1)
      assert.equal(run3.workspacesThrottled, 0)
      assert.equal(apiCalls, 2)
    })

    // -----------------------------------------------------------------------
    // 12. Policy & sensitive-content approval gates remain enforced
    // -----------------------------------------------------------------------
    await test('12. Workspace automation policy (auto_publish_positive + critical + sensitive content) is strictly preserved', () => {
      const settings: WorkspaceReplySettings = {
        workspaceId: 'ws-1',
        autoReplyMode: 'auto_publish_positive',
        requireApprovalForCritical: true,
        defaultReplyTone: 'friendly',
        businessContext: '',
        autoReplyMinRating: 4,
        autoReplyDelayMinutes: 5,
      }

      const positiveClean = evaluateReplyApprovalPolicy(
        5,
        settings,
        'Super quick service and reliable tech solutions!'
      )
      assert.equal(positiveClean.requiresApproval, false)
      assert.equal(positiveClean.status, 'published')

      const criticalReview = evaluateReplyApprovalPolicy(
        2,
        settings,
        'Very slow response time.'
      )
      assert.equal(criticalReview.requiresApproval, true)
      assert.equal(criticalReview.status, 'draft')

      const sensitiveFiveStar = evaluateReplyApprovalPolicy(
        5,
        settings,
        'Great support until my attorney noticed a data breach issue.'
      )
      assert.equal(sensitiveFiveStar.requiresApproval, true)
      assert.equal(sensitiveFiveStar.status, 'draft')
    })

    // -----------------------------------------------------------------------
    // 13. Fail-closed ambiguous profiles (>1 connected locations)
    // -----------------------------------------------------------------------
    await test('13. Workspace with multiple connected locations fails closed with AMBIGUOUS_PROFILE and zero API calls', async () => {
      const db = createInMemoryDb({
        locations: [
          {
            id: 'loc-1',
            workspace_id: 'ws-ambig',
            name: 'Loc 1',
            google_account_id: 'accounts/1',
            google_location_id: 'locations/1',
            is_connected: true,
            updated_at: '2026-11-18T08:00:00.000Z',
          },
          {
            id: 'loc-2',
            workspace_id: 'ws-ambig',
            name: 'Loc 2',
            google_account_id: 'accounts/1',
            google_location_id: 'locations/2',
            is_connected: true,
            updated_at: '2026-11-18T08:00:00.000Z',
          },
        ],
        google_integrations: [
          {
            id: 'int-1',
            workspace_id: 'ws-ambig',
            account_id: 'accounts/1',
            account_name: 'Ambig',
            access_token_encrypted: encryptToken('tok-1'),
            refresh_token_encrypted: encryptToken('ref-1'),
            expires_at: FUTURE_EXPIRY,
            scope: 'https://www.googleapis.com/auth/business.manage',
            updated_at: '2026-11-18T08:00:00.000Z',
          },
        ],
      })

      let fetchCalled = false
      globalThis.fetch = (async () => {
        fetchCalled = true
        return new Response('{}', { status: 200 })
      }) as typeof fetch

      const supabase = buildMockSupabase(db)
      const res = await syncWorkspaceGoogleReviewsFallback(supabase as never, 'ws-ambig', {
        nowMs: NOW_MS,
      })

      assert.equal(res.success, false)
      assert.equal(res.errorCode, 'AMBIGUOUS_PROFILE')
      assert.equal(fetchCalled, false)
    })

    // -----------------------------------------------------------------------
    // 14. Worker integration: runs isolated after due jobs & populates summary
    // -----------------------------------------------------------------------
    await test('14. runScheduledReplyWorker runs periodic fallback sync post-jobs and isolates failures', async () => {
      const db = createInMemoryDb({
        locations: [
          {
            id: 'loc-1',
            workspace_id: 'ws-1',
            name: 'Worker Test Biz',
            google_account_id: 'accounts/1001',
            google_location_id: 'locations/2001',
            is_connected: true,
            updated_at: '2026-11-18T08:00:00.000Z',
          },
        ],
        google_integrations: [
          {
            id: 'int-1',
            workspace_id: 'ws-1',
            account_id: 'accounts/1001',
            account_name: 'Worker Test Biz',
            access_token_encrypted: encryptToken('tok-worker'),
            refresh_token_encrypted: encryptToken('ref-worker'),
            expires_at: FUTURE_EXPIRY,
            scope: 'https://www.googleapis.com/auth/business.manage',
            updated_at: '2026-11-18T08:00:00.000Z',
          },
        ],
        google_connection_health: [
          {
            workspace_id: 'ws-1',
            status: 'connected_verified',
            last_checked_at: new Date(NOW_MS).toISOString(), // skip health probe this tick
            metadata: {},
          },
        ],
      })

      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/reviews')) {
          return new Response(
            JSON.stringify({
              reviews: [
                {
                  reviewId: 'rev-worker-discovered',
                  reviewer: { displayName: 'Worker Discovered' },
                  starRating: 'FIVE',
                  comment: 'Found by periodic fallback sync inside worker!',
                  createTime: '2026-11-18T10:55:00.000Z',
                  updateTime: '2026-11-18T10:55:00.000Z',
                },
              ],
            }),
            { status: 200 }
          )
        }
        return new Response(JSON.stringify({}), { status: 200 })
      }) as typeof fetch

      const supabase = buildMockSupabase(db)
      const workerSummary = await runScheduledReplyWorker(supabase as never, {
        workerId: 'worker-fallback-test',
        triggerSource: 'supabase_cron',
        skipHealthProbe: false,
        fallbackSyncIntervalMinutes: 10,
        nowMs: NOW_MS,
      })

      assert.equal(workerSummary.success, true)
      assert.equal(workerSummary.errors.length, 0)
      assert.ok(workerSummary.fallbackReviewSync)
      assert.equal(workerSummary.fallbackReviewSync.workspacesSynced, 1)
      assert.equal(workerSummary.fallbackReviewSync.inserted, 1)
      assert.equal(workerSummary.fallbackReviewSync.enqueued, 1)
      assert.equal(db.reviews.length, 1)
      assert.equal(db.review_reply_jobs.length, 1)
    })

    // -----------------------------------------------------------------------
    // 15. Edited unanswered review updates DB and deduplicates against existing open job
    // -----------------------------------------------------------------------
    await test('15. Edited unanswered review updates DB and deduplicates against an existing open Pub/Sub job', async () => {
      const db = createInMemoryDb({
        locations: [
          {
            id: 'loc-1',
            workspace_id: 'ws-1',
            name: 'NexFlowOps',
            google_account_id: 'accounts/1001',
            google_location_id: 'locations/2001',
            is_connected: true,
            updated_at: '2026-11-18T10:00:00.000Z',
          },
        ],
        google_integrations: [
          {
            id: 'int-1',
            workspace_id: 'ws-1',
            account_id: 'accounts/1001',
            account_name: 'NexFlowOps',
            access_token_encrypted: encryptToken('tok-1'),
            refresh_token_encrypted: encryptToken('ref-1'),
            expires_at: FUTURE_EXPIRY,
            scope: 'https://www.googleapis.com/auth/business.manage',
            updated_at: '2026-11-18T10:00:00.000Z',
          },
        ],
        reviews: [
          {
            id: 'rev-existing-1',
            workspace_id: 'ws-1',
            location_id: 'loc-1',
            author_name: 'Edit Customer',
            author_photo_url: null,
            rating: 4,
            content: 'Initial review comment',
            review_date: '2026-11-18T10:30:00.000Z',
            source: 'google',
            status: 'unanswered',
            sentiment: 'positive',
            external_review_id: 'rev-edit-1',
          },
        ],
        review_reply_jobs: [
          {
            id: 'job-existing-open',
            workspace_id: 'ws-1',
            location_id: 'loc-1',
            review_id: 'rev-existing-1',
            external_review_id: 'rev-edit-1',
            source_event_id: 'pubsub-msg-1',
            source_event_type: 'NEW_REVIEW',
            status: 'scheduled',
            scheduled_for: new Date(NOW_MS + 3 * 60_000).toISOString(),
            max_attempts: 5,
            metadata: {},
          },
        ],
      })

      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            reviews: [
              {
                reviewId: 'rev-edit-1',
                reviewer: { displayName: 'Edit Customer' },
                starRating: 'FIVE',
                comment: 'Updated to 5 stars — amazing team!',
                createTime: '2026-11-18T10:30:00.000Z',
                updateTime: '2026-11-18T10:55:00.000Z',
              },
            ],
          }),
          { status: 200 }
        )) as typeof fetch

      const supabase = buildMockSupabase(db)
      const res = await syncWorkspaceGoogleReviewsFallback(supabase as never, 'ws-1', {
        nowMs: NOW_MS,
      })

      assert.equal(res.success, true)
      assert.equal(res.updated, 1)
      assert.equal(res.inserted, 0)
      assert.equal(res.enqueued, 0)
      assert.equal(res.deduplicatedJobs, 1)
      assert.equal(db.reviews[0].rating, 5)
      assert.equal(db.reviews[0].content, 'Updated to 5 stars — amazing team!')
      assert.equal(db.review_reply_jobs.length, 1)
    })

    // -----------------------------------------------------------------------
    // 16. maxPages hard cap stops pagination cleanly on high-volume locations
    // -----------------------------------------------------------------------
    await test('16. Bounded maxPages cap stops pagination cleanly and flags truncatedByMaxPages', async () => {
      let pageFetches = 0
      globalThis.fetch = (async () => {
        pageFetches++
        return new Response(
          JSON.stringify({
            reviews: [
              {
                reviewId: `rev-cap-${pageFetches}`,
                reviewer: { displayName: `User ${pageFetches}` },
                starRating: 'FIVE',
                comment: 'Recent review',
                createTime: '2026-11-18T10:55:00.000Z',
                updateTime: '2026-11-18T10:55:00.000Z',
              },
            ],
            nextPageToken: `next-${pageFetches}`,
          }),
          { status: 200 }
        )
      }) as typeof fetch

      const result = await fetchGoogleReviews('tok', 'accounts/1', 'locations/2', {
        maxPages: 2,
        pageSize: 50,
        stopBeforeIso: new Date(NOW_MS - 24 * 3600_000).toISOString(),
        filterToLookback: true,
      })

      assert.equal(result.supported, true)
      assert.equal(pageFetches, 2)
      assert.equal(result.pagesFetched, 2)
      assert.equal(result.truncatedByMaxPages, true)
      assert.equal(result.truncatedByLookback, false)
    })
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY
    else process.env.TOKEN_ENCRYPTION_KEY = originalKey
    if (originalClientId === undefined) delete process.env.GOOGLE_CLIENT_ID
    else process.env.GOOGLE_CLIENT_ID = originalClientId
    if (originalClientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET
    else process.env.GOOGLE_CLIENT_SECRET = originalClientSecret
  }

  console.log(`\nSummary: ${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
}

run().catch((err) => {
  console.error('Fatal test suite error:', err)
  process.exit(1)
})
