import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'
import {
  getGoogleAccountNotificationSetting,
  updateGoogleAccountNotificationSetting,
  GoogleApiError,
} from '@/lib/google-business'
import {
  normalizeGoogleAccountId,
  normalizeGoogleAccountIdBare,
  normalizeGoogleLocationIdBare,
  normalizeGoogleLocationResource,
  resolveConfiguredGooglePubSubTopic,
  sanitizeGoogleDiagnosticError,
  computeNotificationRetryAt,
  mergeRequiredNotificationTypes,
  planNotificationPatch,
  classifyNotificationFailure,
  ensureGoogleAccountNotificationsRegistered,
  confirmGoogleNotificationTopicOverwrite,
  reconcileWorkspaceNotificationRegistrations,
  NotificationRegistrationRow,
} from '@/lib/google-notification-registration'
import { parseGooglePubSubNotificationPayload } from '@/lib/google-pubsub-payload'
import { POST as webhookPost } from '@/app/api/webhooks/google-pubsub/route'
import { runScheduledReplyWorker } from '@/lib/reply-queue'

const STAGING_TOPIC = 'projects/ai-review-manager-511010/topics/gbp-review-notifications'
const OTHER_TOPIC = 'projects/third-party-crm-999/topics/external-gbp-events'
const STAGING_ACCOUNT = 'accounts/108611198428245728238'

let passed = 0
let failed = 0

async function test(num: number, name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    console.log(`  PASS [${String(num).padStart(2, '0')}] ${name}`)
    passed++
  } catch (err: unknown) {
    console.error(`  FAIL [${String(num).padStart(2, '0')}] ${name}`)
    console.error('       ', err instanceof Error ? err.message : err)
    failed++
  }
}

interface MockLockState {
  lock_owner: string
  fence_token: number
  lease_expires_at: number
}

interface MockLocationRow {
  id: string
  workspace_id: string
  google_account_id: string | null
  google_location_id: string | null
  name: string
  is_connected: boolean
}

function createInMemorySupabase(initial?: {
  registrations?: NotificationRegistrationRow[]
  locations?: MockLocationRow[]
  memberships?: Array<{ workspace_id: string; user_id: string; role: string }>
  locks?: Record<string, MockLockState>
  nowMs?: () => number
  forceRenewFailForOwner?: string
}) {
  const nowFn = initial?.nowMs ?? (() => Date.now())
  const regs = new Map<string, NotificationRegistrationRow>()
  for (const r of initial?.registrations || []) {
    regs.set(`${r.workspace_id}::${normalizeGoogleAccountId(r.google_account_id)}`, { ...r })
  }
  const locations: MockLocationRow[] = [...(initial?.locations || [])]
  const memberships = [...(initial?.memberships || [])]
  const locks = new Map<string, MockLockState>(Object.entries(initial?.locks || {}))
  const healthUpdates: Array<Record<string, unknown>> = []
  let seq = 1

  function makeQuery(table: string) {
    const filters: Array<(row: Record<string, unknown>) => boolean> = []
    let limitN = 100

    const getSource = (): Record<string, unknown>[] => {
      if (table === 'google_notification_registrations') {
        return Array.from(regs.values()) as unknown as Record<string, unknown>[]
      }
      if (table === 'locations') {
        return locations as unknown as Record<string, unknown>[]
      }
      return []
    }

    const q = {
      select: () => q,
      eq: (col: string, val: unknown) => {
        filters.push((row) => row[col] === val)
        return q
      },
      in: (col: string, vals: unknown[]) => {
        filters.push((row) => vals.includes(row[col]))
        return q
      },
      not: (col: string, op: string, val: unknown) => {
        if (op === 'is' && val === null) {
          filters.push((row) => row[col] !== null && row[col] !== undefined)
        }
        return q
      },
      or: (expr: string) => {
        // Supports last_verified_at.is.null,last_verified_at.lt.<iso>
        const ltMatch = expr.match(/last_verified_at\.lt\.([^,]+)/)
        if (ltMatch) {
          const cutoff = Date.parse(ltMatch[1])
          filters.push((row) => {
            const v = row.last_verified_at as string | null | undefined
            return !v || Date.parse(v) < cutoff
          })
        }
        return q
      },
      limit: (n: number) => {
        limitN = n
        return q
      },
      maybeSingle: async () => {
        const rows = getSource().filter((r) => filters.every((f) => f(r)))
        return { data: rows[0] ?? null, error: null }
      },
      then: (resolve: (v: { data: unknown[]; error: null }) => void) => {
        const rows = getSource()
          .filter((r) => filters.every((f) => f(r)))
          .slice(0, limitN)
        resolve({ data: rows, error: null })
      },
      upsert: async (payload: Record<string, unknown>) => {
        if (table === 'google_notification_registrations') {
          const acc = normalizeGoogleAccountId(String(payload.google_account_id || ''))
          const key = `${payload.workspace_id}::${acc}`
          const existing = regs.get(key)
          const nowIso = new Date(nowFn()).toISOString()
          const row: NotificationRegistrationRow = {
            id: existing?.id || `reg-${seq++}`,
            workspace_id: String(payload.workspace_id),
            google_account_id: acc,
            pubsub_topic: (payload.pubsub_topic as string | null) ?? null,
            notification_types: (payload.notification_types as string[]) || ['NEW_REVIEW', 'UPDATED_REVIEW'],
            status: (payload.status as NotificationRegistrationRow['status']) || 'pending',
            source: (payload.source as NotificationRegistrationRow['source']) || 'auto_registration',
            attempts: typeof payload.attempts === 'number' ? payload.attempts : (existing?.attempts ?? 0),
            max_attempts: typeof payload.max_attempts === 'number' ? payload.max_attempts : 5,
            next_retry_at: (payload.next_retry_at as string | null) ?? null,
            last_attempt_at: (payload.last_attempt_at as string | null) ?? existing?.last_attempt_at ?? null,
            registered_at: (payload.registered_at as string | null) ?? existing?.registered_at ?? null,
            last_verified_at: (payload.last_verified_at as string | null) ?? existing?.last_verified_at ?? null,
            last_http_status: (payload.last_http_status as number | null) ?? null,
            last_error_code: (payload.last_error_code as string | null) ?? null,
            last_error_message: (payload.last_error_message as string | null) ?? null,
            metadata: (payload.metadata as NotificationRegistrationRow['metadata']) || {},
            created_at: existing?.created_at || nowIso,
            updated_at: (payload.updated_at as string) || nowIso,
          }
          regs.set(key, row)
        } else if (table === 'google_connection_health') {
          healthUpdates.push(payload)
        }
        return { data: null, error: null }
      },
    }
    return q
  }

  const client = {
    from: (table: string) => makeQuery(table),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      const now = nowFn()
      if (fn === 'acquire_google_account_registration_lock') {
        const acc = normalizeGoogleAccountId(String(args.p_google_account_id || ''))
        const owner = String(args.p_lock_owner || '')
        const ttl = Number(args.p_lease_seconds ?? 60)
        const existing = locks.get(acc)
        if (!existing || existing.lease_expires_at <= now) {
          const fence = existing ? existing.fence_token + 1 : 1
          const exp = now + ttl * 1000
          locks.set(acc, { lock_owner: owner, fence_token: fence, lease_expires_at: exp })
          return {
            data: { acquired: true, fence_token: fence, lease_expires_at: new Date(exp).toISOString() },
            error: null,
          }
        }
        return {
          data: {
            acquired: false,
            fence_token: null,
            lease_expires_at: new Date(existing.lease_expires_at).toISOString(),
          },
          error: null,
        }
      }

      if (fn === 'renew_google_account_registration_lock') {
        const acc = normalizeGoogleAccountId(String(args.p_google_account_id || ''))
        const owner = String(args.p_lock_owner || '')
        const fence = Number(args.p_fence_token)
        const ttl = Number(args.p_lease_seconds ?? 60)
        if (initial?.forceRenewFailForOwner && owner === initial.forceRenewFailForOwner) {
          return { data: false, error: null }
        }
        const existing = locks.get(acc)
        if (
          existing &&
          existing.lock_owner === owner &&
          existing.fence_token === fence &&
          existing.lease_expires_at > now
        ) {
          existing.lease_expires_at = now + ttl * 1000
          return { data: true, error: null }
        }
        return { data: false, error: null }
      }

      if (fn === 'release_google_account_registration_lock') {
        const acc = normalizeGoogleAccountId(String(args.p_google_account_id || ''))
        const owner = String(args.p_lock_owner || '')
        const fence = Number(args.p_fence_token)
        const existing = locks.get(acc)
        if (existing && existing.lock_owner === owner && existing.fence_token === fence) {
          locks.delete(acc)
          return { data: true, error: null }
        }
        return { data: false, error: null }
      }

      if (fn === 'claim_and_activate_google_location') {
        const actor = String(args.p_actor_user_id || '')
        const wsId = String(args.p_workspace_id || '')
        const isAuth = memberships.some(
          (m) => m.workspace_id === wsId && m.user_id === actor && (m.role === 'owner' || m.role === 'admin')
        )
        if (!isAuth) {
          return {
            data: { claimed: false, unauthorized: true, conflict: false, location_id: null },
            error: null,
          }
        }
        const normLocBare = normalizeGoogleLocationIdBare(String(args.p_google_location_id || ''))
        const normLoc = normalizeGoogleLocationResource(normLocBare)
        const normAcc = normalizeGoogleAccountId(String(args.p_google_account_id || ''))
        const conflict = locations.some(
          (l) =>
            l.is_connected &&
            l.workspace_id !== wsId &&
            normalizeGoogleLocationIdBare(l.google_location_id) === normLocBare
        )
        if (conflict) {
          return {
            data: { claimed: false, unauthorized: false, conflict: true, location_id: null },
            error: null,
          }
        }
        for (const l of locations) {
          if (l.workspace_id === wsId) l.is_connected = false
        }
        let existingLoc = locations.find(
          (l) =>
            l.workspace_id === wsId &&
            normalizeGoogleLocationIdBare(l.google_location_id) === normLocBare
        )
        if (existingLoc) {
          existingLoc.is_connected = true
          existingLoc.google_account_id = normAcc
          existingLoc.google_location_id = normLoc
          existingLoc.name = String(args.p_name || existingLoc.name)
        } else {
          existingLoc = {
            id: `loc-${seq++}`,
            workspace_id: wsId,
            google_account_id: normAcc,
            google_location_id: normLoc,
            name: String(args.p_name || 'Location'),
            is_connected: true,
          }
          locations.push(existingLoc)
        }
        return {
          data: {
            claimed: true,
            unauthorized: false,
            conflict: false,
            location_id: existingLoc.id,
            google_account_id: normAcc,
            google_location_id: normLoc,
          },
          error: null,
        }
      }

      return { data: null, error: null }
    },
  }

  return {
    client: client as never,
    callRpc: client.rpc,
    regs,
    locations,
    locks,
    healthUpdates,
  }
}

async function run() {
  console.log('\n=== NexRep Multi-Tenant GBP Pub/Sub Auto-Registration Offline Test Suite (45 Scenarios) ===\n')

  const originalFetch = globalThis.fetch
  const originalTopic = process.env.GOOGLE_PUBSUB_TOPIC

  try {
    // -------------------------------------------------------------------------
    // Tests 1-6: Official Notifications API v1 Contract & Minimal updateMask
    // -------------------------------------------------------------------------
    await test(1, 'Official Notifications API v1 GET & PATCH endpoint and response contract', async () => {
      const captured: Array<{ url: string; method: string; body?: string }> = []
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        const method = (init?.method || 'GET').toUpperCase()
        captured.push({ url, method, body: init?.body ? String(init.body) : undefined })
        return new Response(
          JSON.stringify({
            name: `${STAGING_ACCOUNT}/notificationSetting`,
            pubsubTopic: STAGING_TOPIC,
            notificationTypes: ['NEW_REVIEW', 'UPDATED_REVIEW'],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      const getRes = await getGoogleAccountNotificationSetting('tok-1', STAGING_ACCOUNT)
      assert.equal(getRes.success, true)
      assert.equal(getRes.endpointUsed, 'mybusinessnotifications_v1')
      assert.equal(
        captured[0].url,
        `https://mybusinessnotifications.googleapis.com/v1/${STAGING_ACCOUNT}/notificationSetting`
      )

      const patchRes = await updateGoogleAccountNotificationSetting(
        'tok-1',
        STAGING_ACCOUNT,
        STAGING_TOPIC,
        ['NEW_REVIEW', 'UPDATED_REVIEW']
      )
      assert.equal(patchRes.success, true)
      assert.equal(patchRes.httpStatus, 200)
      assert.equal(captured[1].method, 'PATCH')
      assert.equal(
        captured[1].url,
        `https://mybusinessnotifications.googleapis.com/v1/${STAGING_ACCOUNT}/notificationSetting?updateMask=pubsubTopic%2CnotificationTypes`
      )
    })

    await test(2, 'Exact minimal updateMask=pubsubTopic when only topic changes', async () => {
      let capturedUrl = ''
      let capturedBody: Record<string, unknown> = {}
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        capturedBody = JSON.parse(String(init?.body || '{}'))
        return new Response(JSON.stringify({ name: `${STAGING_ACCOUNT}/notificationSetting`, pubsubTopic: STAGING_TOPIC }), {
          status: 200,
        })
      }

      const plan = planNotificationPatch(
        { pubsubTopic: '', notificationTypes: ['NEW_REVIEW', 'UPDATED_REVIEW', 'GOOGLE_UPDATE'] },
        STAGING_TOPIC
      )
      assert.equal(plan.action, 'patch_needed')
      if (plan.action === 'patch_needed') {
        assert.deepEqual(plan.updateMask, ['pubsubTopic'])
        await updateGoogleAccountNotificationSetting('tok', STAGING_ACCOUNT, plan.targetTopic, plan.mergedTypes, {
          updateMask: plan.updateMask,
        })
        assert.ok(capturedUrl.endsWith('?updateMask=pubsubTopic'))
        assert.equal(capturedBody.pubsubTopic, STAGING_TOPIC)
        assert.equal('notificationTypes' in capturedBody, false)
      }
    })

    await test(3, 'Exact minimal updateMask=notificationTypes when only event types are missing', async () => {
      let capturedUrl = ''
      let capturedBody: Record<string, unknown> = {}
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        capturedBody = JSON.parse(String(init?.body || '{}'))
        return new Response(JSON.stringify(capturedBody), { status: 200 })
      }

      const plan = planNotificationPatch(
        { pubsubTopic: STAGING_TOPIC, notificationTypes: ['GOOGLE_UPDATE', 'NEW_REVIEW'] },
        STAGING_TOPIC
      )
      assert.equal(plan.action, 'patch_needed')
      if (plan.action === 'patch_needed') {
        assert.deepEqual(plan.updateMask, ['notificationTypes'])
        await updateGoogleAccountNotificationSetting('tok', STAGING_ACCOUNT, plan.targetTopic, plan.mergedTypes, {
          updateMask: plan.updateMask,
        })
        assert.ok(capturedUrl.endsWith('?updateMask=notificationTypes'))
        assert.equal('pubsubTopic' in capturedBody, false)
        assert.deepEqual(capturedBody.notificationTypes, ['GOOGLE_UPDATE', 'NEW_REVIEW', 'UPDATED_REVIEW'])
      }
    })

    await test(4, 'Exact updateMask=pubsubTopic,notificationTypes when both topic and types are set', () => {
      const plan = planNotificationPatch({ pubsubTopic: '', notificationTypes: [] }, STAGING_TOPIC)
      assert.equal(plan.action, 'patch_needed')
      if (plan.action === 'patch_needed') {
        assert.deepEqual(plan.updateMask, ['pubsubTopic', 'notificationTypes'])
        assert.deepEqual(plan.mergedTypes, ['NEW_REVIEW', 'UPDATED_REVIEW'])
      }
    })

    await test(5, 'Preserves additional valid merchant notificationTypes and filters NOTIFICATION_TYPE_UNSPECIFIED', () => {
      const merged = mergeRequiredNotificationTypes([
        'NOTIFICATION_TYPE_UNSPECIFIED',
        'GOOGLE_UPDATE',
        'VOICE_OF_MERCHANT_UPDATED',
        'NEW_REVIEW',
      ])
      assert.deepEqual(merged, ['GOOGLE_UPDATE', 'VOICE_OF_MERCHANT_UPDATED', 'NEW_REVIEW', 'UPDATED_REVIEW'])
    })

    await test(6, 'Pre-flight rejects empty pubsubTopic and empty notificationTypes BEFORE HTTP PATCH', async () => {
      let networkCalled = false
      globalThis.fetch = async () => {
        networkCalled = true
        return new Response('{}', { status: 200 })
      }

      const emptyTopicRes = await updateGoogleAccountNotificationSetting('tok', STAGING_ACCOUNT, '', ['NEW_REVIEW', 'UPDATED_REVIEW'])
      assert.equal(emptyTopicRes.success, false)
      assert.equal(emptyTopicRes.errorCode, 'INVALID_PUBSUB_TOPIC')
      assert.equal(networkCalled, false)

      const emptyTypesRes = await updateGoogleAccountNotificationSetting('tok', STAGING_ACCOUNT, STAGING_TOPIC, [])
      assert.equal(emptyTypesRes.success, false)
      assert.equal(emptyTypesRes.errorCode, 'INVALID_NOTIFICATION_TYPES')
      assert.equal(networkCalled, false)

      const partialTypesRes = await updateGoogleAccountNotificationSetting('tok', STAGING_ACCOUNT, STAGING_TOPIC, ['NEW_REVIEW'])
      assert.equal(partialTypesRes.success, false)
      assert.equal(partialTypesRes.errorCode, 'INVALID_NOTIFICATION_TYPES')
      assert.equal(networkCalled, false)
    })

    // -------------------------------------------------------------------------
    // Tests 7-11: Fresh Registration, Staging Reconciliation, Idempotency & Multi-Location
    // -------------------------------------------------------------------------
    await test(7, 'Fresh registration succeeds (GET empty -> single PATCH -> registered)', async () => {
      const db = createInMemorySupabase()
      let patchCalls = 0
      const res = await ensureGoogleAccountNotificationsRegistered(
        db.client,
        { workspaceId: 'ws-1', googleAccountId: '108611198428245728238' },
        {
          configuredTopicOverride: STAGING_TOPIC,
          getAccessToken: async () => ({ accessToken: 'tok-ws1', accountId: STAGING_ACCOUNT, accountName: 'a@b.com' }),
          getSetting: async () => ({ success: true, httpStatus: 200, setting: { pubsubTopic: '', notificationTypes: [] } }),
          updateSetting: async (_t, _a, topic, types) => {
            patchCalls++
            return { success: true, httpStatus: 200, setting: { pubsubTopic: topic, notificationTypes: types } }
          },
        }
      )
      assert.equal(res.success, true)
      assert.equal(res.outcome, 'registered')
      assert.equal(patchCalls, 1)
      assert.equal(db.regs.size, 1)
      const row = db.regs.get(`ws-1::${STAGING_ACCOUNT}`)!
      assert.equal(row.status, 'registered')
      assert.equal(row.attempts, 1)
      assert.ok(row.registered_at)
      assert.equal(db.locks.size, 0)
    })

    await test(8, 'Existing manually configured staging account reconciles via GET ONLY (zero PATCH)', async () => {
      const db = createInMemorySupabase()
      let patchCalls = 0
      const res = await ensureGoogleAccountNotificationsRegistered(
        db.client,
        { workspaceId: 'ws-staging', googleAccountId: STAGING_ACCOUNT },
        {
          configuredTopicOverride: STAGING_TOPIC,
          getAccessToken: async () => ({ accessToken: 'tok-stg', accountId: STAGING_ACCOUNT, accountName: 'stg@test.com' }),
          getSetting: async () => ({
            success: true,
            httpStatus: 200,
            setting: {
              name: `${STAGING_ACCOUNT}/notificationSetting`,
              pubsubTopic: STAGING_TOPIC,
              notificationTypes: ['NEW_REVIEW', 'UPDATED_REVIEW', 'GOOGLE_UPDATE'],
            },
          }),
          updateSetting: async () => {
            patchCalls++
            throw new Error('PATCH must NOT be called!')
          },
        }
      )
      assert.equal(res.success, true)
      assert.equal(res.outcome, 'reconciled_existing')
      assert.equal(res.patchCalled, false)
      assert.equal(patchCalls, 0)
      const row = db.regs.get(`ws-staging::${STAGING_ACCOUNT}`)!
      assert.equal(row.source, 'reconciled_existing')
      assert.deepEqual(row.notification_types, ['NEW_REVIEW', 'UPDATED_REVIEW', 'GOOGLE_UPDATE'])
    })

    await test(9, 'Idempotent repeated registration within 24h short-circuits at Layer 1 (0 Google calls)', async () => {
      const now = Date.parse('2026-11-18T10:00:00.000Z')
      const db = createInMemorySupabase({ nowMs: () => now })
      let googleCalls = 0
      const deps = {
        nowMs: () => now,
        configuredTopicOverride: STAGING_TOPIC,
        getAccessToken: async () => ({ accessToken: 'tok', accountId: STAGING_ACCOUNT, accountName: 'a' }),
        getSetting: async () => {
          googleCalls++
          return { success: true, httpStatus: 200, setting: { pubsubTopic: STAGING_TOPIC, notificationTypes: ['NEW_REVIEW', 'UPDATED_REVIEW'] } }
        },
        updateSetting: async () => ({ success: true, httpStatus: 200 }),
      }

      const r1 = await ensureGoogleAccountNotificationsRegistered(db.client, { workspaceId: 'ws-1', googleAccountId: STAGING_ACCOUNT }, deps)
      assert.equal(r1.apiCallsMade, 1)
      const r2 = await ensureGoogleAccountNotificationsRegistered(db.client, { workspaceId: 'ws-1', googleAccountId: STAGING_ACCOUNT }, deps)
      assert.equal(r2.outcome, 'already_registered')
      assert.equal(r2.apiCallsMade, 0)
      assert.equal(googleCalls, 1)
    })

    await test(10, 'Switching locations under the same GBP account keeps registered row with 0 API calls (no location_id coupling)', async () => {
      const now = Date.parse('2026-11-18T10:00:00.000Z')
      const db = createInMemorySupabase({
        nowMs: () => now,
        memberships: [{ workspace_id: 'ws-1', user_id: 'u-1', role: 'owner' }],
        registrations: [
          {
            id: 'reg-1',
            workspace_id: 'ws-1',
            google_account_id: 'accounts/123',
            pubsub_topic: STAGING_TOPIC,
            notification_types: ['NEW_REVIEW', 'UPDATED_REVIEW'],
            status: 'registered',
            source: 'auto_registration',
            attempts: 1,
            max_attempts: 5,
            next_retry_at: null,
            last_attempt_at: new Date(now).toISOString(),
            registered_at: new Date(now).toISOString(),
            last_verified_at: new Date(now).toISOString(),
            last_http_status: 200,
            last_error_code: null,
            last_error_message: null,
            metadata: {},
            created_at: new Date(now).toISOString(),
            updated_at: new Date(now).toISOString(),
          },
        ],
      })
      // Switch from loc A to loc B under same account 123
      await db.callRpc('claim_and_activate_google_location', {
        p_actor_user_id: 'u-1',
        p_workspace_id: 'ws-1',
        p_google_account_id: 'accounts/123',
        p_google_location_id: 'locations/locA',
        p_name: 'Loc A',
      })
      await db.callRpc('claim_and_activate_google_location', {
        p_actor_user_id: 'u-1',
        p_workspace_id: 'ws-1',
        p_google_account_id: 'accounts/123',
        p_google_location_id: 'locations/locB',
        p_name: 'Loc B',
      })

      const res = await ensureGoogleAccountNotificationsRegistered(
        db.client,
        { workspaceId: 'ws-1', googleAccountId: 'accounts/123' },
        {
          nowMs: () => now + 60_000,
          configuredTopicOverride: STAGING_TOPIC,
          getSetting: async () => {
            throw new Error('Should not call Google API when switching locations under same account!')
          },
        }
      )
      assert.equal(res.outcome, 'already_registered')
      assert.equal(res.apiCallsMade, 0)
      assert.equal(db.regs.size, 1)
    })

    await test(11, 'Switching to a location under a different GBP account creates an independent registration row', async () => {
      const db = createInMemorySupabase()
      const deps = {
        configuredTopicOverride: STAGING_TOPIC,
        getAccessToken: async () => ({ accessToken: 'tok', accountId: null, accountName: null }),
        getSetting: async () => ({ success: true, httpStatus: 200, setting: { pubsubTopic: '', notificationTypes: [] } }),
        updateSetting: async (_t: string, _a: string, topic: string, types?: string[]) => ({
          success: true,
          httpStatus: 200,
          setting: { pubsubTopic: topic, notificationTypes: types || [] },
        }),
      }
      await ensureGoogleAccountNotificationsRegistered(db.client, { workspaceId: 'ws-1', googleAccountId: 'accounts/111' }, deps)
      await ensureGoogleAccountNotificationsRegistered(db.client, { workspaceId: 'ws-1', googleAccountId: 'accounts/222' }, deps)
      assert.equal(db.regs.size, 2)
      assert.ok(db.regs.has('ws-1::accounts/111'))
      assert.ok(db.regs.has('ws-1::accounts/222'))
    })

    // -------------------------------------------------------------------------
    // Tests 12-16: Atomic Claim, Preflight, Cross-Workspace Conflict, Anti-Oracle, RPC Auth
    // -------------------------------------------------------------------------
    await test(12, 'Atomic location claim succeeds and normalizes locations/ and accounts/ consistently', async () => {
      const db = createInMemorySupabase({
        memberships: [{ workspace_id: 'ws-1', user_id: 'owner-1', role: 'owner' }],
      })
      const { data } = await db.callRpc('claim_and_activate_google_location', {
        p_actor_user_id: 'owner-1',
        p_workspace_id: 'ws-1',
        p_google_account_id: '  Accounts/998877 ',
        p_google_location_id: ' 7435614085041125705 ',
        p_name: 'Test Biz',
      })
      const d = data as Record<string, unknown>
      assert.equal(d.claimed, true)
      assert.equal(d.google_account_id, 'accounts/998877')
      assert.equal(d.google_location_id, 'locations/7435614085041125705')
      assert.equal(normalizeGoogleAccountId('  Accounts/998877 '), 'accounts/998877')
      assert.equal(normalizeGoogleLocationResource(' 7435614085041125705 '), 'locations/7435614085041125705')
    })

    await test(13, 'Duplicate active location migration preflight SQL checks normalized locations and aborts cleanly', () => {
      const sql = fs.readFileSync(
        path.resolve(process.cwd(), 'supabase/migrations/20261118160000_add_google_notification_registrations.sql'),
        'utf8'
      )
      assert.ok(sql.includes("lower(regexp_replace(trim(google_location_id), '^/?locations/', '', 'i'))"))
      assert.ok(sql.includes('RAISE EXCEPTION'))
      assert.ok(sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_one_active_per_google_location'))
      assert.ok(!sql.includes('DELETE FROM public.locations'))
    })

    await test(14, 'Concurrent cross-workspace claim conflict returns privacy-safe error without mutating caller rows', async () => {
      const db = createInMemorySupabase({
        memberships: [
          { workspace_id: 'ws-1', user_id: 'u-1', role: 'owner' },
          { workspace_id: 'ws-2', user_id: 'u-2', role: 'owner' },
        ],
        locations: [
          { id: 'loc-ws2-old', workspace_id: 'ws-2', google_account_id: 'accounts/2', google_location_id: 'locations/200', name: 'WS2 Existing', is_connected: true },
        ],
      })
      const r1 = await db.callRpc('claim_and_activate_google_location', {
        p_actor_user_id: 'u-1',
        p_workspace_id: 'ws-1',
        p_google_account_id: 'accounts/1',
        p_google_location_id: 'locations/7435614085041125705',
        p_name: 'Claimed by WS1',
      })
      assert.equal((r1.data as Record<string, unknown>).claimed, true)

      // WS-2 attempts to claim bare ID of exact same location
      const r2 = await db.callRpc('claim_and_activate_google_location', {
        p_actor_user_id: 'u-2',
        p_workspace_id: 'ws-2',
        p_google_account_id: 'accounts/1',
        p_google_location_id: '7435614085041125705',
        p_name: 'Conflict Attempt',
      })
      const r2d = r2.data as Record<string, unknown>
      assert.equal(r2d.claimed, false)
      assert.equal(r2d.conflict, true)
      assert.equal(r2d.location_id, null)
      assert.equal(JSON.stringify(r2d).includes('ws-1'), false)
      // WS-2's existing active location remains untouched!
      assert.equal(db.locations.find((l) => l.id === 'loc-ws2-old')?.is_connected, true)
    })

    await test(15, 'Live Google OAuth ownership verification in selectSingleGoogleProfileAction rejects unowned IDs before RPC', () => {
      const actionsSrc = fs.readFileSync(
        path.resolve(process.cwd(), 'src/app/dashboard/locations/actions.ts'),
        'utf8'
      )
      const ownershipIdx = actionsSrc.indexOf('fetchGoogleLocations(accessToken, matchedAccount.name)')
      const rpcIdx = actionsSrc.indexOf("rpc(\n      'claim_and_activate_google_location'")
      assert.ok(ownershipIdx > 0, 'Expected live Google OAuth ownership check')
      assert.ok(rpcIdx > ownershipIdx, 'OAuth ownership check MUST precede claim_and_activate_google_location RPC')
    })

    await test(16, 'Internal RPC authorization rejects member/non-member actor_user_id', async () => {
      const db = createInMemorySupabase({
        memberships: [{ workspace_id: 'ws-1', user_id: 'member-1', role: 'member' }],
      })
      const rMember = await db.callRpc('claim_and_activate_google_location', {
        p_actor_user_id: 'member-1',
        p_workspace_id: 'ws-1',
        p_google_account_id: 'accounts/1',
        p_google_location_id: 'locations/99',
        p_name: 'Blocked',
      })
      assert.equal((rMember.data as Record<string, unknown>).claimed, false)
      assert.equal((rMember.data as Record<string, unknown>).unauthorized, true)

      const rOutsider = await db.callRpc('claim_and_activate_google_location', {
        p_actor_user_id: 'outsider-99',
        p_workspace_id: 'ws-1',
        p_google_account_id: 'accounts/1',
        p_google_location_id: 'locations/99',
        p_name: 'Blocked',
      })
      assert.equal((rOutsider.data as Record<string, unknown>).claimed, false)
      assert.equal((rOutsider.data as Record<string, unknown>).unauthorized, true)
    })

    // -------------------------------------------------------------------------
    // Tests 17-20: Distributed Fenced Account Lock Semantics
    // -------------------------------------------------------------------------
    await test(17, 'Account lock contention makes 0 Google API calls, defers pending (+30s), burns 0 attempts', async () => {
      const now = Date.parse('2026-11-18T10:00:00.000Z')
      const db = createInMemorySupabase({
        nowMs: () => now,
        locks: {
          [STAGING_ACCOUNT]: { lock_owner: 'other-proc', fence_token: 3, lease_expires_at: now + 50_000 },
        },
      })
      let googleCalled = false
      const res = await ensureGoogleAccountNotificationsRegistered(
        db.client,
        { workspaceId: 'ws-2', googleAccountId: STAGING_ACCOUNT },
        {
          nowMs: () => now,
          configuredTopicOverride: STAGING_TOPIC,
          getSetting: async () => {
            googleCalled = true
            return { success: true }
          },
        }
      )
      assert.equal(res.outcome, 'deferred_locked')
      assert.equal(res.apiCallsMade, 0)
      assert.equal(googleCalled, false)
      const row = db.regs.get(`ws-2::${STAGING_ACCOUNT}`)!
      assert.equal(row.status, 'pending')
      assert.equal(row.attempts, 0)
      assert.equal(row.next_retry_at, new Date(now + 30_000).toISOString())
    })

    await test(18, 'Lease expiry recovery allows new owner to reclaim expired lease with incremented fence_token', async () => {
      let now = Date.parse('2026-11-18T10:00:00.000Z')
      const db = createInMemorySupabase({ nowMs: () => now })
      const a1 = await db.callRpc('acquire_google_account_registration_lock', {
        p_google_account_id: STAGING_ACCOUNT,
        p_lock_owner: 'owner-A',
        p_lease_seconds: 30,
      })
      assert.equal((a1.data as Record<string, unknown>).acquired, true)
      assert.equal((a1.data as Record<string, unknown>).fence_token, 1)

      // Advance past lease expiry
      now += 31_000
      const a2 = await db.callRpc('acquire_google_account_registration_lock', {
        p_google_account_id: STAGING_ACCOUNT,
        p_lock_owner: 'owner-B',
        p_lease_seconds: 60,
      })
      assert.equal((a2.data as Record<string, unknown>).acquired, true)
      assert.equal((a2.data as Record<string, unknown>).fence_token, 2)
    })

    await test(19, 'Stale lock owner failing pre-PATCH renew aborts with 0 PATCH calls', async () => {
      const db = createInMemorySupabase({ forceRenewFailForOwner: 'stale-owner-1' })
      let patchCalled = false
      const res = await ensureGoogleAccountNotificationsRegistered(
        db.client,
        { workspaceId: 'ws-1', googleAccountId: STAGING_ACCOUNT },
        {
          configuredTopicOverride: STAGING_TOPIC,
          generateLockOwner: () => 'stale-owner-1',
          getAccessToken: async () => ({ accessToken: 'tok', accountId: STAGING_ACCOUNT, accountName: null }),
          getSetting: async () => ({ success: true, httpStatus: 200, setting: { pubsubTopic: '', notificationTypes: [] } }),
          updateSetting: async () => {
            patchCalled = true
            return { success: true, httpStatus: 200 }
          },
        }
      )
      assert.equal(res.outcome, 'lock_lost')
      assert.equal(res.patchCalled, false)
      assert.equal(patchCalled, false)
    })

    await test(20, 'Stale lock owner cannot release another owner active lock', async () => {
      let now = Date.parse('2026-11-18T10:00:00.000Z')
      const db = createInMemorySupabase({ nowMs: () => now })
      await db.callRpc('acquire_google_account_registration_lock', {
        p_google_account_id: STAGING_ACCOUNT,
        p_lock_owner: 'owner-A',
        p_lease_seconds: 30,
      })
      now += 35_000
      await db.callRpc('acquire_google_account_registration_lock', {
        p_google_account_id: STAGING_ACCOUNT,
        p_lock_owner: 'owner-B',
        p_lease_seconds: 60,
      })
      // Owner A attempts late release with stale fence_token 1
      const rel = await db.callRpc('release_google_account_registration_lock', {
        p_google_account_id: STAGING_ACCOUNT,
        p_lock_owner: 'owner-A',
        p_fence_token: 1,
      })
      assert.equal(rel.data, false)
      assert.equal(db.locks.get(STAGING_ACCOUNT)?.lock_owner, 'owner-B')
    })

    // -------------------------------------------------------------------------
    // Tests 21-26: Shared Account, Topic Conflict, Explicit Overwrite, Non-Destructive Disconnect
    // -------------------------------------------------------------------------
    await test(21, 'Shared GBP account across 2 workspaces uses separate OAuth tokens (1 PATCH + 1 GET-only reconciliation)', async () => {
      const db = createInMemorySupabase()
      let googleTopic = ''
      let googleTypes: string[] = []
      let patchCalls = 0
      const tokensUsed: Array<{ ws: string; token: string }> = []

      const deps = {
        configuredTopicOverride: STAGING_TOPIC,
        getAccessToken: async (_sb: unknown, wsId: string) => {
          const tok = wsId === 'ws-1' ? 'tok-ws-1-secret' : 'tok-ws-2-secret'
          tokensUsed.push({ ws: wsId, token: tok })
          return { accessToken: tok, accountId: 'accounts/123', accountName: `${wsId}@biz.com` }
        },
        getSetting: async () => ({
          success: true,
          httpStatus: 200,
          setting: { pubsubTopic: googleTopic, notificationTypes: googleTypes },
        }),
        updateSetting: async (_t: string, _a: string, topic: string, types?: string[]) => {
          patchCalls++
          googleTopic = topic
          googleTypes = types || []
          return { success: true, httpStatus: 200, setting: { pubsubTopic: topic, notificationTypes: googleTypes } }
        },
      }

      const r1 = await ensureGoogleAccountNotificationsRegistered(db.client, { workspaceId: 'ws-1', googleAccountId: 'accounts/123' }, deps)
      const r2 = await ensureGoogleAccountNotificationsRegistered(db.client, { workspaceId: 'ws-2', googleAccountId: 'accounts/123' }, deps)

      assert.equal(r1.outcome, 'registered')
      assert.equal(r2.outcome, 'reconciled_existing')
      assert.equal(patchCalls, 1)
      assert.deepEqual(tokensUsed, [
        { ws: 'ws-1', token: 'tok-ws-1-secret' },
        { ws: 'ws-2', token: 'tok-ws-2-secret' },
      ])
      assert.equal(db.regs.size, 2)
    })

    await test(22, 'Third-party pubsubTopic conflict protection records topic_conflict with 0 PATCH calls', async () => {
      const db = createInMemorySupabase()
      let patchCalls = 0
      const res = await ensureGoogleAccountNotificationsRegistered(
        db.client,
        { workspaceId: 'ws-1', googleAccountId: 'accounts/555' },
        {
          configuredTopicOverride: STAGING_TOPIC,
          getAccessToken: async () => ({ accessToken: 'tok', accountId: 'accounts/555', accountName: null }),
          getSetting: async () => ({
            success: true,
            httpStatus: 200,
            setting: { pubsubTopic: OTHER_TOPIC, notificationTypes: ['GOOGLE_UPDATE', 'NEW_REVIEW'] },
          }),
          updateSetting: async () => {
            patchCalls++
            return { success: true }
          },
        }
      )
      assert.equal(res.outcome, 'topic_conflict')
      assert.equal(res.existingThirdPartyTopic, OTHER_TOPIC)
      assert.equal(patchCalls, 0)
      assert.equal(db.regs.get('ws-1::accounts/555')?.status, 'topic_conflict')
    })

    await test(23, 'Explicit topic overwrite succeeds ONLY with matching expected topic and preserves existing types', async () => {
      const db = createInMemorySupabase()
      let capturedTypes: string[] = []
      const res = await confirmGoogleNotificationTopicOverwrite(
        db.client,
        {
          workspaceId: 'ws-1',
          googleAccountId: 'accounts/555',
          actorUserId: 'owner-1',
          expectedCurrentTopic: OTHER_TOPIC,
        },
        {
          configuredTopicOverride: STAGING_TOPIC,
          getAccessToken: async () => ({ accessToken: 'tok', accountId: 'accounts/555', accountName: null }),
          getSetting: async () => ({
            success: true,
            httpStatus: 200,
            setting: { pubsubTopic: OTHER_TOPIC, notificationTypes: ['GOOGLE_UPDATE'] },
          }),
          updateSetting: async (_t, _a, topic, types) => {
            capturedTypes = types || []
            return { success: true, httpStatus: 200, setting: { pubsubTopic: topic, notificationTypes: capturedTypes } }
          },
        }
      )
      assert.equal(res.success, true)
      assert.equal(res.status, 'registered')
      assert.deepEqual(capturedTypes, ['GOOGLE_UPDATE', 'NEW_REVIEW', 'UPDATED_REVIEW'])
      const row = db.regs.get('ws-1::accounts/555')!
      assert.equal(row.source, 'explicit_overwrite')
      assert.equal((row.metadata as Record<string, unknown>).explicitOverwriteConfirmedByUserId, 'owner-1')
    })

    await test(24, 'Stale overwrite confirmation is rejected with 0 PATCH calls when topic changed externally', async () => {
      const db = createInMemorySupabase()
      let patchCalled = false
      const res = await confirmGoogleNotificationTopicOverwrite(
        db.client,
        {
          workspaceId: 'ws-1',
          googleAccountId: 'accounts/555',
          actorUserId: 'owner-1',
          expectedCurrentTopic: OTHER_TOPIC,
        },
        {
          configuredTopicOverride: STAGING_TOPIC,
          getAccessToken: async () => ({ accessToken: 'tok', accountId: 'accounts/555', accountName: null }),
          getSetting: async () => ({
            success: true,
            httpStatus: 200,
            setting: { pubsubTopic: 'projects/brand-new-999/topics/newer', notificationTypes: ['NEW_REVIEW'] },
          }),
          updateSetting: async () => {
            patchCalled = true
            return { success: true }
          },
        }
      )
      assert.equal(res.success, false)
      assert.equal(res.outcome, 'stale_confirmation')
      assert.equal(patchCalled, false)
      assert.equal(db.regs.get('ws-1::accounts/555')?.status, 'topic_conflict')
    })

    await test(25, 'Unauthorized overwrite confirmation is rejected (server action verifies owner/admin)', () => {
      const actionsSrc = fs.readFileSync(
        path.resolve(process.cwd(), 'src/app/dashboard/locations/actions.ts'),
        'utf8'
      )
      const fnIdx = actionsSrc.indexOf('export async function confirmGoogleNotificationTopicOverwriteAction')
      const block = actionsSrc.slice(fnIdx, fnIdx + 1200)
      assert.ok(block.includes('supabase.auth.getUser()'))
      assert.ok(block.includes("verifyWorkspaceMembership(supabase, workspaceId, [\n      'owner',\n      'admin',\n    ])"))
    })

    await test(26, 'Non-destructive disconnect only updates local locations.is_connected=false with 0 Google API calls', () => {
      const actionsSrc = fs.readFileSync(
        path.resolve(process.cwd(), 'src/app/dashboard/locations/actions.ts'),
        'utf8'
      )
      const fnIdx = actionsSrc.indexOf('export async function disconnectGoogleProfileAction')
      const block = actionsSrc.slice(fnIdx, fnIdx + 1200)
      assert.ok(block.includes('is_connected: false'))
      assert.ok(!block.includes('updateGoogleAccountNotificationSetting'))
      assert.ok(!block.includes('google_notification_registrations'))
    })

    // -------------------------------------------------------------------------
    // Tests 27-32: Webhook Validation & Strict Multi-Tenant Routing
    // -------------------------------------------------------------------------
    const origWebhookToken = process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN
    const origWebhookAud = process.env.GOOGLE_PUBSUB_PUSH_AUDIENCE
    const origWebhookSA = process.env.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT
    const origSbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const origSbKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.GOOGLE_PUBSUB_PUSH_AUDIENCE
    delete process.env.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT
    process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN = 'test-notif-webhook-tok'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://mock-offline-test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-offline-service-role-key'

    function makeWebhookReq(payloadObj: Record<string, unknown>, messageId: string) {
      const b64 = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64')
      return new NextRequest(
        'https://nex-rev-staging.vercel.app/api/webhooks/google-pubsub?token=test-notif-webhook-tok',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: { data: b64, messageId } }),
        }
      )
    }

    try {
      await test(27, 'Webhook routes accounts/123/locations/A -> WS-1 and locations/B -> WS-2 with strict isolation', async () => {
        const checkedWorkspaces: string[] = []
        const jsonHeaders = { 'Content-Type': 'application/json' }
        globalThis.fetch = async (input: RequestInfo | URL) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          if (url.includes('/rest/v1/locations')) {
            if (url.toLowerCase().includes('alpha111')) {
              return new Response(
                JSON.stringify([{ id: 'l-1', workspace_id: 'ws-1', name: 'A', google_location_id: 'locations/alpha111', google_account_id: 'accounts/123', is_connected: true }]),
                { status: 200, headers: jsonHeaders }
              )
            }
            if (url.toLowerCase().includes('beta222')) {
              return new Response(
                JSON.stringify([{ id: 'l-2', workspace_id: 'ws-2', name: 'B', google_location_id: 'locations/beta222', google_account_id: 'accounts/123', is_connected: true }]),
                { status: 200, headers: jsonHeaders }
              )
            }
            return new Response(JSON.stringify([{ id: 'l-single' }]), { status: 200, headers: jsonHeaders })
          }
          if (url.includes('/rest/v1/google_integrations')) {
            const ws = url.includes('ws-1') ? 'ws-1' : 'ws-2'
            checkedWorkspaces.push(ws)
            return new Response(
              JSON.stringify({ id: 'i', workspace_id: ws, scope: 'openid https://www.googleapis.com/auth/business.manage' }),
              { status: 200, headers: jsonHeaders }
            )
          }
          if (url.includes('/rest/v1/review_automation_events')) {
            return new Response(
              JSON.stringify({ event_id: 'dup', processing_status: 'published', review_id: 'r' }),
              { status: 200, headers: jsonHeaders }
            )
          }
          return new Response(JSON.stringify(null), { status: 200, headers: jsonHeaders })
        }

        const resA = await webhookPost(makeWebhookReq({ type: 'NEW_REVIEW', location: 'accounts/123/locations/alpha111', review: 'accounts/123/locations/alpha111/reviews/r1' }, 'm-a'))
        const resB = await webhookPost(makeWebhookReq({ type: 'NEW_REVIEW', location: 'accounts/123/locations/beta222', review: 'accounts/123/locations/beta222/reviews/r2' }, 'm-b'))
        assert.equal(resA.status, 200)
        assert.equal(resB.status, 200)
        const jsonA = await resA.json()
        const jsonB = await resB.json()
        assert.equal(jsonA.duplicate, true)
        assert.equal(jsonB.duplicate, true)
        assert.deepEqual(checkedWorkspaces, ['ws-1', 'ws-2'])
      })

      await test(28, 'Ambiguous webhook active location (>1 workspaces) fails closed (200 ignored, 0 writes, 0 Google calls)', async () => {
        let writes = 0
        let googleCalls = 0
        globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          if (url.includes('googleapis.com')) googleCalls++
          if ((init?.method || 'GET') !== 'GET') writes++
          if (url.includes('/rest/v1/locations')) {
            return new Response(
              JSON.stringify([
                { id: 'l-1', workspace_id: 'ws-1', name: 'A', google_location_id: 'locations/777', google_account_id: 'accounts/123', is_connected: true },
                { id: 'l-2', workspace_id: 'ws-2', name: 'A', google_location_id: 'locations/777', google_account_id: 'accounts/123', is_connected: true },
              ]),
              { status: 200 }
            )
          }
          return new Response(JSON.stringify(null), { status: 200 })
        }

        const res = await webhookPost(
          makeWebhookReq({ type: 'NEW_REVIEW', location: 'accounts/123/locations/777', review: 'accounts/123/locations/777/reviews/r9' }, 'm-ambig')
        )
        const json = await res.json()
        assert.equal(res.status, 200)
        assert.equal(json.ignored, true)
        assert.equal(writes, 0)
        assert.equal(googleCalls, 0)
      })

      await test(29, 'Disconnected location (is_connected=false) is ignored with 0 DB writes', async () => {
        let writes = 0
        globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          if ((init?.method || 'GET') !== 'GET') writes++
          if (url.includes('/rest/v1/locations')) {
            return new Response(
              JSON.stringify([
                { id: 'l-1', workspace_id: 'ws-1', name: 'Old', google_location_id: 'locations/888', google_account_id: 'accounts/123', is_connected: false },
              ]),
              { status: 200 }
            )
          }
          return new Response(JSON.stringify(null), { status: 200 })
        }

        const res = await webhookPost(
          makeWebhookReq({ type: 'NEW_REVIEW', location: 'accounts/123/locations/888', review: 'accounts/123/locations/888/reviews/r10' }, 'm-disc')
        )
        const json = await res.json()
        assert.equal(res.status, 200)
        assert.equal(json.ignored, true)
        assert.equal(writes, 0)
      })

      await test(30, 'Conflicting webhook payload accountId/locationId between location and review is rejected', async () => {
        const pAccConflict = parseGooglePubSubNotificationPayload({
          type: 'NEW_REVIEW',
          location: 'accounts/111/locations/777',
          review: 'accounts/222/locations/777/reviews/r1',
        })
        assert.equal(pAccConflict.hasConflictingIdentifiers, true)
        assert.equal(pAccConflict.hasRequiredIdentifiers, false)

        const pLocConflict = parseGooglePubSubNotificationPayload({
          type: 'NEW_REVIEW',
          location: 'accounts/111/locations/777',
          review: 'accounts/111/locations/888/reviews/r1',
        })
        assert.equal(pLocConflict.hasConflictingIdentifiers, true)
        assert.equal(pLocConflict.hasRequiredIdentifiers, false)

        const res = await webhookPost(
          makeWebhookReq({ type: 'NEW_REVIEW', location: 'accounts/111/locations/777', review: 'accounts/222/locations/777/reviews/r1' }, 'm-conf')
        )
        const json = await res.json()
        assert.equal(res.status, 200)
        assert.equal(json.ignored, true)
      })

      await test(31, 'Webhook google_account_id mismatch against DB location row is ignored', async () => {
        let writes = 0
        globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          if ((init?.method || 'GET') !== 'GET') writes++
          if (url.includes('/rest/v1/locations')) {
            return new Response(
              JSON.stringify([
                { id: 'l-1', workspace_id: 'ws-1', name: 'X', google_location_id: 'locations/777', google_account_id: 'accounts/999', is_connected: true },
              ]),
              { status: 200 }
            )
          }
          return new Response(JSON.stringify(null), { status: 200 })
        }

        const res = await webhookPost(
          makeWebhookReq({ type: 'NEW_REVIEW', location: 'accounts/123/locations/777', review: 'accounts/123/locations/777/reviews/r11' }, 'm-accmis')
        )
        const json = await res.json()
        assert.equal(res.status, 200)
        assert.equal(json.ignored, true)
        assert.equal(writes, 0)
      })

      await test(32, 'Webhook workspace missing business.manage scope is ignored with 0 DB writes', async () => {
        let writes = 0
        globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          if ((init?.method || 'GET') !== 'GET') writes++
          if (url.includes('/rest/v1/locations')) {
            return new Response(
              JSON.stringify([{ id: 'l-1', workspace_id: 'ws-1', name: 'X', google_location_id: 'locations/777', google_account_id: 'accounts/123', is_connected: true }]),
              { status: 200 }
            )
          }
          if (url.includes('/rest/v1/google_integrations')) {
            return new Response(JSON.stringify({ id: 'i', workspace_id: 'ws-1', scope: 'openid email' }), { status: 200 })
          }
          return new Response(JSON.stringify(null), { status: 200 })
        }

        const res = await webhookPost(
          makeWebhookReq({ type: 'NEW_REVIEW', location: 'accounts/123/locations/777', review: 'accounts/123/locations/777/reviews/r12' }, 'm-scope')
        )
        const json = await res.json()
        assert.equal(res.status, 200)
        assert.equal(json.ignored, true)
        assert.equal(writes, 0)
      })
    } finally {
      if (origWebhookToken === undefined) delete process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN
      else process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN = origWebhookToken
      if (origWebhookAud !== undefined) process.env.GOOGLE_PUBSUB_PUSH_AUDIENCE = origWebhookAud
      if (origWebhookSA !== undefined) process.env.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT = origWebhookSA
      if (origSbUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
      else process.env.NEXT_PUBLIC_SUPABASE_URL = origSbUrl
      if (origSbKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
      else process.env.SUPABASE_SERVICE_ROLE_KEY = origSbKey
      globalThis.fetch = originalFetch
    }

    // -------------------------------------------------------------------------
    // Tests 33-39: Retries, skipped_unconfigured, 24h Drift Detection & Repair
    // -------------------------------------------------------------------------
    await test(33, '429/503 transient failure schedules 2/4/8/16/32m exponential backoff', async () => {
      const base = Date.parse('2026-11-18T10:00:00.000Z')
      assert.equal(computeNotificationRetryAt(1, base), new Date(base + 2 * 60_000).toISOString())
      assert.equal(computeNotificationRetryAt(2, base), new Date(base + 4 * 60_000).toISOString())
      assert.equal(computeNotificationRetryAt(3, base), new Date(base + 8 * 60_000).toISOString())
      assert.equal(computeNotificationRetryAt(4, base), new Date(base + 16 * 60_000).toISOString())
      assert.equal(computeNotificationRetryAt(5, base), new Date(base + 32 * 60_000).toISOString())

      const db = createInMemorySupabase({ nowMs: () => base })
      const res = await ensureGoogleAccountNotificationsRegistered(
        db.client,
        { workspaceId: 'ws-1', googleAccountId: STAGING_ACCOUNT },
        {
          nowMs: () => base,
          configuredTopicOverride: STAGING_TOPIC,
          getAccessToken: async () => ({ accessToken: 'tok', accountId: STAGING_ACCOUNT, accountName: null }),
          getSetting: async () => ({ success: true, httpStatus: 200, setting: { pubsubTopic: '', notificationTypes: [] } }),
          updateSetting: async () => ({ success: false, httpStatus: 503, errorCode: 'UNAVAILABLE', error: 'Service unavailable' }),
        }
      )
      assert.equal(res.status, 'failed')
      const row = db.regs.get(`ws-1::${STAGING_ACCOUNT}`)!
      assert.equal(row.attempts, 1)
      assert.equal(row.next_retry_at, new Date(base + 2 * 60_000).toISOString())
    })

    await test(34, 'Retry after failure succeeds via worker reconciliation without OAuth reconnect', async () => {
      const now = Date.parse('2026-11-18T10:00:00.000Z')
      const db = createInMemorySupabase({
        nowMs: () => now,
        registrations: [
          {
            id: 'r-fail',
            workspace_id: 'ws-1',
            google_account_id: STAGING_ACCOUNT,
            pubsub_topic: STAGING_TOPIC,
            notification_types: ['NEW_REVIEW', 'UPDATED_REVIEW'],
            status: 'failed',
            source: 'auto_registration',
            attempts: 1,
            max_attempts: 5,
            next_retry_at: new Date(now - 1000).toISOString(),
            last_attempt_at: new Date(now - 180_000).toISOString(),
            registered_at: null,
            last_verified_at: null,
            last_http_status: 503,
            last_error_code: 'transient_google_error',
            last_error_message: '503',
            metadata: {},
            created_at: new Date(now - 180_000).toISOString(),
            updated_at: new Date(now - 180_000).toISOString(),
          },
        ],
      })
      const summary = await reconcileWorkspaceNotificationRegistrations(
        db.client,
        { limit: 5 },
        {
          nowMs: () => now,
          configuredTopicOverride: STAGING_TOPIC,
          getAccessToken: async () => ({ accessToken: 'tok-from-refresh', accountId: STAGING_ACCOUNT, accountName: null }),
          getSetting: async () => ({ success: true, httpStatus: 200, setting: { pubsubTopic: '', notificationTypes: [] } }),
          updateSetting: async (_t, _a, topic, types) => ({ success: true, httpStatus: 200, setting: { pubsubTopic: topic, notificationTypes: types } }),
        }
      )
      assert.equal(summary.registered, 1)
      const row = db.regs.get(`ws-1::${STAGING_ACCOUNT}`)!
      assert.equal(row.status, 'registered')
      assert.equal(row.attempts, 2)
      assert.equal(row.next_retry_at, null)
    })

    await test(35, 'skipped_unconfigured burns 0 attempts while unset and auto-reconciles once GOOGLE_PUBSUB_TOPIC is set', async () => {
      const db = createInMemorySupabase()
      const rUnset = await ensureGoogleAccountNotificationsRegistered(
        db.client,
        { workspaceId: 'ws-1', googleAccountId: STAGING_ACCOUNT },
        { configuredTopicOverride: '' }
      )
      assert.equal(rUnset.outcome, 'skipped_unconfigured')
      assert.equal(db.regs.get(`ws-1::${STAGING_ACCOUNT}`)?.attempts, 0)

      // Worker short-circuits cleanly while still unset
      const wUnset = await reconcileWorkspaceNotificationRegistrations(db.client, { limit: 5 }, { configuredTopicOverride: '' })
      assert.equal(wUnset.skippedUnconfigured, true)
      assert.equal(wUnset.scanned, 0)

      // Once topic is configured, worker reconciles skipped_unconfigured automatically without reconnect
      const wConfigured = await reconcileWorkspaceNotificationRegistrations(
        db.client,
        { limit: 5 },
        {
          configuredTopicOverride: STAGING_TOPIC,
          getAccessToken: async () => ({ accessToken: 'stored-refresh-tok', accountId: STAGING_ACCOUNT, accountName: null }),
          getSetting: async () => ({ success: true, httpStatus: 200, setting: { pubsubTopic: '', notificationTypes: [] } }),
          updateSetting: async (_t, _a, topic, types) => ({ success: true, httpStatus: 200, setting: { pubsubTopic: topic, notificationTypes: types } }),
        }
      )
      assert.equal(wConfigured.skippedUnconfigured, false)
      assert.equal(wConfigured.registered, 1)
      assert.equal(db.regs.get(`ws-1::${STAGING_ACCOUNT}`)?.status, 'registered')
    })

    await test(36, 'Registered account drift detection triggers after 24 hours', async () => {
      const now = Date.parse('2026-11-19T12:00:00.000Z')
      const stale = new Date(now - 25 * 60 * 60 * 1000).toISOString()
      const db = createInMemorySupabase({
        nowMs: () => now,
        registrations: [
          {
            id: 'r-stale',
            workspace_id: 'ws-1',
            google_account_id: STAGING_ACCOUNT,
            pubsub_topic: STAGING_TOPIC,
            notification_types: ['NEW_REVIEW', 'UPDATED_REVIEW'],
            status: 'registered',
            source: 'auto_registration',
            attempts: 1,
            max_attempts: 5,
            next_retry_at: null,
            last_attempt_at: stale,
            registered_at: stale,
            last_verified_at: stale,
            last_http_status: 200,
            last_error_code: null,
            last_error_message: null,
            metadata: {},
            created_at: stale,
            updated_at: stale,
          },
        ],
      })
      let getCalled = false
      const summary = await reconcileWorkspaceNotificationRegistrations(
        db.client,
        { limit: 5 },
        {
          nowMs: () => now,
          configuredTopicOverride: STAGING_TOPIC,
          getAccessToken: async () => ({ accessToken: 'tok', accountId: STAGING_ACCOUNT, accountName: null }),
          getSetting: async () => {
            getCalled = true
            return { success: true, httpStatus: 200, setting: { pubsubTopic: STAGING_TOPIC, notificationTypes: ['NEW_REVIEW', 'UPDATED_REVIEW'] } }
          },
        }
      )
      assert.equal(getCalled, true)
      assert.equal(summary.reconciledWithoutPatch, 1)
      assert.equal(db.regs.get(`ws-1::${STAGING_ACCOUNT}`)?.last_verified_at, new Date(now).toISOString())
    })

    await test(37, 'External topic change detected during drift check becomes topic_conflict with 0 PATCH calls', async () => {
      const now = Date.parse('2026-11-19T12:00:00.000Z')
      const stale = new Date(now - 26 * 60 * 60 * 1000).toISOString()
      const db = createInMemorySupabase({
        nowMs: () => now,
        registrations: [
          {
            id: 'r-drift',
            workspace_id: 'ws-1',
            google_account_id: STAGING_ACCOUNT,
            pubsub_topic: STAGING_TOPIC,
            notification_types: ['NEW_REVIEW', 'UPDATED_REVIEW'],
            status: 'registered',
            source: 'auto_registration',
            attempts: 1,
            max_attempts: 5,
            next_retry_at: null,
            last_attempt_at: stale,
            registered_at: stale,
            last_verified_at: stale,
            last_http_status: 200,
            last_error_code: null,
            last_error_message: null,
            metadata: {},
            created_at: stale,
            updated_at: stale,
          },
        ],
      })
      let patchCalled = false
      const summary = await reconcileWorkspaceNotificationRegistrations(
        db.client,
        { limit: 5 },
        {
          nowMs: () => now,
          configuredTopicOverride: STAGING_TOPIC,
          getAccessToken: async () => ({ accessToken: 'tok', accountId: STAGING_ACCOUNT, accountName: null }),
          getSetting: async () => ({ success: true, httpStatus: 200, setting: { pubsubTopic: OTHER_TOPIC, notificationTypes: ['NEW_REVIEW', 'UPDATED_REVIEW'] } }),
          updateSetting: async () => {
            patchCalled = true
            return { success: true }
          },
        }
      )
      assert.equal(summary.conflicts, 1)
      assert.equal(patchCalled, false)
      assert.equal(db.regs.get(`ws-1::${STAGING_ACCOUNT}`)?.status, 'topic_conflict')
    })

    await test(38, 'Missing event types during drift check are repaired via updateMask=notificationTypes preserving other types', async () => {
      const now = Date.parse('2026-11-19T12:00:00.000Z')
      const stale = new Date(now - 26 * 60 * 60 * 1000).toISOString()
      const db = createInMemorySupabase({
        nowMs: () => now,
        registrations: [
          {
            id: 'r-missing-type',
            workspace_id: 'ws-1',
            google_account_id: STAGING_ACCOUNT,
            pubsub_topic: STAGING_TOPIC,
            notification_types: ['NEW_REVIEW', 'UPDATED_REVIEW'],
            status: 'registered',
            source: 'auto_registration',
            attempts: 1,
            max_attempts: 5,
            next_retry_at: null,
            last_attempt_at: stale,
            registered_at: stale,
            last_verified_at: stale,
            last_http_status: 200,
            last_error_code: null,
            last_error_message: null,
            metadata: {},
            created_at: stale,
            updated_at: stale,
          },
        ],
      })
      let maskUsed: string[] = []
      let typesSent: string[] = []
      const summary = await reconcileWorkspaceNotificationRegistrations(
        db.client,
        { limit: 5 },
        {
          nowMs: () => now,
          configuredTopicOverride: STAGING_TOPIC,
          getAccessToken: async () => ({ accessToken: 'tok', accountId: STAGING_ACCOUNT, accountName: null }),
          getSetting: async () => ({ success: true, httpStatus: 200, setting: { pubsubTopic: STAGING_TOPIC, notificationTypes: ['GOOGLE_UPDATE'] } }),
          updateSetting: async (_t, _a, topic, types, opts) => {
            maskUsed = opts?.updateMask || []
            typesSent = types || []
            return { success: true, httpStatus: 200, setting: { pubsubTopic: topic, notificationTypes: typesSent } }
          },
        }
      )
      assert.equal(summary.repaired, 1)
      assert.deepEqual(maskUsed, ['notificationTypes'])
      assert.deepEqual(typesSent, ['GOOGLE_UPDATE', 'NEW_REVIEW', 'UPDATED_REVIEW'])
    })

    await test(39, 'Unchanged settings update last_verified_at without calling PATCH', async () => {
      const now = Date.parse('2026-11-19T12:00:00.000Z')
      const db = createInMemorySupabase({ nowMs: () => now })
      let patchCalls = 0
      const res = await ensureGoogleAccountNotificationsRegistered(
        db.client,
        { workspaceId: 'ws-1', googleAccountId: STAGING_ACCOUNT, forceVerify: true },
        {
          nowMs: () => now,
          configuredTopicOverride: STAGING_TOPIC,
          getAccessToken: async () => ({ accessToken: 'tok', accountId: STAGING_ACCOUNT, accountName: null }),
          getSetting: async () => ({ success: true, httpStatus: 200, setting: { pubsubTopic: STAGING_TOPIC, notificationTypes: ['NEW_REVIEW', 'UPDATED_REVIEW'] } }),
          updateSetting: async () => {
            patchCalls++
            return { success: true }
          },
        }
      )
      assert.equal(res.patchCalled, false)
      assert.equal(patchCalls, 0)
      assert.equal(db.regs.get(`ws-1::${STAGING_ACCOUNT}`)?.last_verified_at, new Date(now).toISOString())
    })

    // -------------------------------------------------------------------------
    // Tests 40-45: 401 Force Refresh, invalid_grant, IAM 403, Sanitization, SQL/Types Contract, Worker Isolation
    // -------------------------------------------------------------------------
    await test(40, 'Exactly one HTTP 401 force-refresh retry succeeds without looping', async () => {
      const db = createInMemorySupabase()
      let refreshCalledWithForce = 0
      let getAttempts = 0
      const res = await ensureGoogleAccountNotificationsRegistered(
        db.client,
        { workspaceId: 'ws-1', googleAccountId: STAGING_ACCOUNT },
        {
          configuredTopicOverride: STAGING_TOPIC,
          getAccessToken: async (_sb, _ws, opts) => {
            if (opts?.forceRefresh) refreshCalledWithForce++
            return {
              accessToken: opts?.forceRefresh ? 'fresh-tok' : 'stale-tok',
              accountId: STAGING_ACCOUNT,
              accountName: null,
            }
          },
          getSetting: async (tok) => {
            getAttempts++
            if (tok === 'stale-tok') {
              return { success: false, httpStatus: 401, errorCode: 'UNAUTHENTICATED', error: 'Invalid credentials' }
            }
            return { success: true, httpStatus: 200, setting: { pubsubTopic: STAGING_TOPIC, notificationTypes: ['NEW_REVIEW', 'UPDATED_REVIEW'] } }
          },
        }
      )
      assert.equal(res.success, true)
      assert.equal(refreshCalledWithForce, 1)
      assert.equal(getAttempts, 2)
    })

    await test(41, 'invalid_grant marks registration failed/revoked with next_retry_at=null and updates google_connection_health', async () => {
      const db = createInMemorySupabase()
      const res = await ensureGoogleAccountNotificationsRegistered(
        db.client,
        { workspaceId: 'ws-1', googleAccountId: STAGING_ACCOUNT },
        {
          configuredTopicOverride: STAGING_TOPIC,
          getAccessToken: async () => {
            throw new GoogleApiError(
              'Google authorization has been revoked or expired. Please reconnect your Google Business Profile account.',
              401,
              'INVALID_GRANT'
            )
          },
        }
      )
      assert.equal(res.status, 'failed')
      assert.equal(res.errorCode, 'revoked')
      const row = db.regs.get(`ws-1::${STAGING_ACCOUNT}`)!
      assert.equal(row.next_retry_at, null)
      assert.equal(db.healthUpdates.length, 1)
      assert.equal(db.healthUpdates[0].status, 'revoked')
    })

    await test(42, 'Primary Notifications v1 403 missing Pub/Sub IAM is NOT masked by deprecated v4 fallback', async () => {
      let fetchCalls = 0
      globalThis.fetch = async () => {
        fetchCalls++
        return new Response(
          JSON.stringify({
            error: {
              code: 403,
              status: 'PERMISSION_DENIED',
              message: 'mybusiness-api-pubsub@system.gserviceaccount.com lacks pubsub.topics.publish permission on topic.',
            },
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        )
      }

      const getRes = await getGoogleAccountNotificationSetting('tok', STAGING_ACCOUNT)
      assert.equal(getRes.success, false)
      assert.equal(getRes.httpStatus, 403)
      assert.equal(getRes.endpointUsed, 'mybusinessnotifications_v1')
      assert.equal(fetchCalls, 1)

      const classified = classifyNotificationFailure(getRes.httpStatus, getRes.errorCode, getRes.error)
      assert.equal(classified.category, 'pubsub_iam_missing')
      assert.equal(classified.retryable, false)
    })

    await test(43, 'Credential sanitizer scrubs Bearer tokens, ya29, refresh tokens, and client_secret', () => {
      const raw =
        'Authorization: Bearer ya29.a0AfH6SMB_SUPER_SECRET failed with refresh_token=1//0gSECRET_REFRESH and client_secret="GOCSPX-TOPSECRET"'
      const clean = sanitizeGoogleDiagnosticError(raw)
      assert.ok(!clean.includes('ya29.'))
      assert.ok(!clean.includes('SUPER_SECRET'))
      assert.ok(!clean.includes('1//0gSECRET'))
      assert.ok(!clean.includes('GOCSPX-TOPSECRET'))
      assert.ok(clean.includes('[REDACTED]'))
    })

    await test(44, 'Migration SQL enforces strict RLS, service_role-only grants, no location_id column, and matching database.types.ts RPC signatures', () => {
      const sql = fs.readFileSync(
        path.resolve(process.cwd(), 'supabase/migrations/20261118160000_add_google_notification_registrations.sql'),
        'utf8'
      )
      const typesSrc = fs.readFileSync(
        path.resolve(process.cwd(), 'src/types/database.types.ts'),
        'utf8'
      )

      // No location_id column on google_notification_registrations
      const regTableSection = sql.slice(
        sql.indexOf('CREATE TABLE IF NOT EXISTS public.google_notification_registrations'),
        sql.indexOf('CREATE TABLE IF NOT EXISTS public.google_account_registration_locks')
      )
      assert.ok(!/\blocation_id\b/.test(regTableSection), 'google_notification_registrations must NOT contain location_id')

      // Strict RLS: SELECT only for authenticated on registrations, ZERO client policies on locks
      assert.ok(regTableSection.includes('FOR SELECT TO authenticated'))
      assert.ok(!regTableSection.includes('FOR INSERT TO authenticated'))
      assert.ok(!regTableSection.includes('FOR UPDATE TO authenticated'))
      assert.ok(!regTableSection.includes('FOR DELETE TO authenticated'))

      // Exact REVOKE/GRANT service_role only for all 4 RPCs
      for (const rpcName of [
        'claim_and_activate_google_location',
        'acquire_google_account_registration_lock',
        'renew_google_account_registration_lock',
        'release_google_account_registration_lock',
      ]) {
        assert.ok(sql.includes(`REVOKE ALL ON FUNCTION public.${rpcName}`), `Missing REVOKE for ${rpcName}`)
        assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION public.${rpcName}`), `Missing GRANT for ${rpcName}`)
        assert.ok(typesSrc.includes(`${rpcName}:`), `Missing database.types.ts signature for ${rpcName}`)
      }
      assert.ok(typesSrc.includes('google_notification_registrations:'))
      assert.ok(typesSrc.includes('google_account_registration_locks:'))
      assert.equal(resolveConfiguredGooglePubSubTopic(STAGING_TOPIC).configured, true)
      assert.equal(resolveConfiguredGooglePubSubTopic('bad-topic').configured, false)
      assert.equal(normalizeGoogleAccountIdBare('accounts/12345'), '12345')
    })

    await test(45, 'Scheduled reply processing remains independent from registration reconciliation errors', async () => {
      process.env.GOOGLE_PUBSUB_TOPIC = STAGING_TOPIC
      const mockSupabase = {
        rpc: async (fn: string) => {
          if (fn === 'claim_due_review_reply_jobs') return { data: [], error: null }
          throw new Error('Simulated lock RPC outage during notification reconciliation')
        },
        from: (table: string) => {
          if (table === 'automation_worker_runs') {
            return {
              insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'run-iso' }, error: null }) }) }),
              update: () => ({ eq: async () => ({ error: null }) }),
            }
          }
          if (table === 'google_integrations') {
            return { select: async () => ({ data: [], error: null }) }
          }
          if (table === 'google_notification_registrations') {
            return {
              select: () => ({
                in: () => ({
                  limit: async () => {
                    throw new Error('Simulated notification table failure')
                  },
                }),
              }),
            }
          }
          return { select: async () => ({ data: [], error: null }) }
        },
      }

      const summary = await runScheduledReplyWorker(mockSupabase as never, {
        workerId: 'worker-iso-test',
        triggerSource: 'supabase_cron',
        skipHealthProbe: false,
      })
      assert.equal(summary.success, true)
      assert.equal(summary.errors.length, 0)
    })
  } finally {
    globalThis.fetch = originalFetch
    if (originalTopic === undefined) delete process.env.GOOGLE_PUBSUB_TOPIC
    else process.env.GOOGLE_PUBSUB_TOPIC = originalTopic
  }

  console.log(`\nSummary: ${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
}

run().catch((err) => {
  console.error('Fatal test suite error:', err)
  process.exit(1)
})
