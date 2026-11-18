import crypto from 'crypto'
import type { Database, Json } from '@/types/database.types'
import type { TypedSupabaseClient } from '@/lib/reply-safety'
import {
  getValidGoogleAccessToken,
  getGoogleAccountNotificationSetting,
  updateGoogleAccountNotificationSetting,
  GoogleApiError,
  GoogleNotificationSetting,
  GoogleNotificationSettingResult,
  NotificationUpdateMaskField,
} from '@/lib/google-business'
import { recordGoogleConnectionHealth } from '@/lib/reply-queue'

export type NotificationRegistrationRow =
  Database['public']['Tables']['google_notification_registrations']['Row']
export type NotificationRegistrationStatus = NotificationRegistrationRow['status']
export type NotificationRegistrationSource = NotificationRegistrationRow['source']

export const REQUIRED_GBP_NOTIFICATION_TYPES = ['NEW_REVIEW', 'UPDATED_REVIEW'] as const
export const VALID_PUBSUB_TOPIC_REGEX = /^projects\/[a-z0-9-]+\/topics\/[A-Za-z0-9-_.~+%]+$/
export const NOTIFICATION_VERIFICATION_FRESH_MS = 24 * 60 * 60 * 1000
export const DEFAULT_ACCOUNT_LOCK_LEASE_SECONDS = 60
export const LOCK_CONTENTION_RETRY_SECONDS = 30
export const MAX_NOTIFICATION_RETRY_ATTEMPTS = 5

/**
 * Canonical normalization helpers matching the exact SQL expressions in
 * 20261118160000_add_google_notification_registrations.sql.
 */
export function normalizeGoogleAccountIdBare(raw: string | null | undefined): string {
  const bare = (raw || '').trim().replace(/^\/?accounts\//i, '').toLowerCase()
  if (!bare || /[\s/]/.test(bare)) return ''
  return bare
}

export function normalizeGoogleAccountId(raw: string | null | undefined): string {
  const bare = normalizeGoogleAccountIdBare(raw)
  return bare ? `accounts/${bare}` : ''
}

export function normalizeGoogleLocationIdBare(raw: string | null | undefined): string {
  const bare = (raw || '').trim().replace(/^\/?locations\//i, '').toLowerCase()
  if (!bare || /[\s/]/.test(bare)) return ''
  return bare
}

export function normalizeGoogleLocationResource(raw: string | null | undefined): string {
  const bare = normalizeGoogleLocationIdBare(raw)
  return bare ? `locations/${bare}` : ''
}

export function resolveConfiguredGooglePubSubTopic(overrideTopic?: string | null): {
  configured: boolean
  topic: string | null
  reason?: string
} {
  const raw =
    overrideTopic !== undefined
      ? (overrideTopic || '').trim()
      : (process.env.GOOGLE_PUBSUB_TOPIC || '').trim()

  if (!raw) {
    return {
      configured: false,
      topic: null,
      reason: 'GOOGLE_PUBSUB_TOPIC environment variable is not configured.',
    }
  }

  if (!VALID_PUBSUB_TOPIC_REGEX.test(raw)) {
    return {
      configured: false,
      topic: null,
      reason: 'GOOGLE_PUBSUB_TOPIC does not match required projects/{project}/topics/{topic} format.',
    }
  }

  return { configured: true, topic: raw }
}

/**
 * Scrubs any OAuth access tokens, refresh tokens, client secrets, or Authorization headers
 * from diagnostic strings before persisting to database, logging, or returning to UI.
 */
export function sanitizeGoogleDiagnosticError(raw: string | null | undefined): string {
  const text = (raw || '').trim()
  if (!text) return 'Unknown Google notification registration error.'

  return text
    .replace(/Authorization\s*:\s*Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Authorization: Bearer [REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/ya29\.[A-Za-z0-9\-._]+/g, '[REDACTED_ACCESS_TOKEN]')
    .replace(/1\/\/[A-Za-z0-9\-._]+/g, '[REDACTED_REFRESH_TOKEN]')
    .replace(/(access_token|refresh_token|client_secret)\s*([=:])\s*["']?[^\s"',;&}]+["']?/gi, '$1$2[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500)
}

/**
 * Deterministic exponential backoff schedule: 2, 4, 8, 16, 32 minutes.
 */
export function computeNotificationRetryAt(attempts: number, nowMs: number = Date.now()): string {
  const safeAttempt = Math.max(1, Math.min(5, Math.floor(attempts)))
  const backoffMinutes = Math.min(32, Math.pow(2, safeAttempt))
  return new Date(nowMs + backoffMinutes * 60_000).toISOString()
}

/**
 * Merges existing valid merchant notification types with required NEW_REVIEW and UPDATED_REVIEW.
 * Filters out NOTIFICATION_TYPE_UNSPECIFIED while preserving all other merchant-configured types.
 */
export function mergeRequiredNotificationTypes(existingTypes?: string[] | null): string[] {
  const cleanedExisting = (existingTypes || [])
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter((t) => t.length > 0 && t !== 'NOTIFICATION_TYPE_UNSPECIFIED')

  const merged = [...cleanedExisting]
  for (const required of REQUIRED_GBP_NOTIFICATION_TYPES) {
    if (!merged.includes(required)) {
      merged.push(required)
    }
  }
  return Array.from(new Set(merged))
}

export function hasRequiredNotificationTypes(types?: string[] | null): boolean {
  if (!Array.isArray(types)) return false
  return REQUIRED_GBP_NOTIFICATION_TYPES.every((req) => types.includes(req))
}

export type NotificationPatchPlan =
  | {
      action: 'already_configured'
      existingTopic: string
      mergedTypes: string[]
    }
  | {
      action: 'topic_conflict'
      existingTopic: string
      targetTopic: string
      mergedTypes: string[]
    }
  | {
      action: 'stale_overwrite_confirmation'
      existingTopic: string
      expectedTopic: string
      targetTopic: string
    }
  | {
      action: 'patch_needed'
      updateMask: NotificationUpdateMaskField[]
      targetTopic: string
      mergedTypes: string[]
      previousTopic: string | null
    }

/**
 * Pure reconciliation planner: decides whether to skip PATCH, report conflict, or apply
 * the smallest safe updateMask while preserving all existing valid merchant types.
 */
export function planNotificationPatch(
  liveSetting: GoogleNotificationSetting | undefined,
  targetTopic: string,
  options?: {
    allowThirdPartyTopicOverwrite?: boolean
    expectedExistingTopic?: string
  }
): NotificationPatchPlan {
  const existingTopic = (liveSetting?.pubsubTopic || '').trim()
  const existingTypes = Array.isArray(liveSetting?.notificationTypes)
    ? liveSetting.notificationTypes
    : []
  const mergedTypes = mergeRequiredNotificationTypes(existingTypes)
  const typesSatisfied = hasRequiredNotificationTypes(existingTypes)
  const topicMatches = existingTopic === targetTopic

  if (topicMatches && typesSatisfied) {
    return {
      action: 'already_configured',
      existingTopic,
      mergedTypes,
    }
  }

  // Protect non-empty third-party / other-environment Pub/Sub topics from silent overwrite
  if (existingTopic && !topicMatches) {
    if (!options?.allowThirdPartyTopicOverwrite) {
      return {
        action: 'topic_conflict',
        existingTopic,
        targetTopic,
        mergedTypes,
      }
    }

    const expected = (options.expectedExistingTopic || '').trim()
    if (!expected || existingTopic !== expected) {
      return {
        action: 'stale_overwrite_confirmation',
        existingTopic,
        expectedTopic: expected,
        targetTopic,
      }
    }
  }

  const updateMask: NotificationUpdateMaskField[] = []
  if (!topicMatches) {
    updateMask.push('pubsubTopic')
  }
  if (!typesSatisfied) {
    updateMask.push('notificationTypes')
  }

  return {
    action: 'patch_needed',
    updateMask,
    targetTopic,
    mergedTypes,
    previousTopic: existingTopic || null,
  }
}

export type NotificationErrorCategory =
  | 'revoked'
  | 'pubsub_iam_missing'
  | 'permission_denied'
  | 'invalid_argument'
  | 'transient_google_error'

export function classifyNotificationFailure(
  httpStatus?: number | null,
  errorCode?: string | null,
  errorMessage?: string | null
): { category: NotificationErrorCategory; retryable: boolean } {
  const code = (errorCode || '').toLowerCase()
  const msg = (errorMessage || '').toLowerCase()

  if (
    httpStatus === 401 ||
    code.includes('invalid_grant') ||
    code.includes('unauthenticated') ||
    msg.includes('invalid_grant') ||
    msg.includes('revoked or expired') ||
    msg.includes('authorization has been revoked') ||
    msg.includes('no refresh token') ||
    msg.includes('reconnect your google') ||
    msg.includes('reconnect google')
  ) {
    return { category: 'revoked', retryable: false }
  }

  if (
    msg.includes('mybusiness-api-pubsub') ||
    msg.includes('pubsub.topics.publish') ||
    (msg.includes('publisher') && msg.includes('topic')) ||
    (httpStatus === 403 && msg.includes('pubsub'))
  ) {
    return { category: 'pubsub_iam_missing', retryable: false }
  }

  if (httpStatus === 403 || code.includes('permission_denied')) {
    return { category: 'permission_denied', retryable: false }
  }

  if (httpStatus === 400 || code.includes('invalid_argument') || code.includes('invalid_')) {
    return { category: 'invalid_argument', retryable: false }
  }

  if (
    httpStatus === 429 ||
    (typeof httpStatus === 'number' && httpStatus >= 500) ||
    code.includes('network_error') ||
    code.includes('resource_exhausted') ||
    msg.includes('timeout') ||
    msg.includes('aborted') ||
    msg.includes('network')
  ) {
    return { category: 'transient_google_error', retryable: true }
  }

  return { category: 'transient_google_error', retryable: true }
}

export interface NotificationRegistrationDeps {
  getAccessToken?: typeof getValidGoogleAccessToken
  getSetting?: typeof getGoogleAccountNotificationSetting
  updateSetting?: typeof updateGoogleAccountNotificationSetting
  recordHealth?: typeof recordGoogleConnectionHealth
  nowMs?: () => number
  generateLockOwner?: (source: string) => string
  configuredTopicOverride?: string | null
}

export interface EnsureNotificationRegistrationParams {
  workspaceId: string
  googleAccountId: string
  source?: NotificationRegistrationSource
  forceVerify?: boolean
  resetAttempts?: boolean
  leaseSeconds?: number
}

export interface NotificationRegistrationOutcome {
  success: boolean
  outcome:
    | 'already_registered'
    | 'reconciled_existing'
    | 'registered'
    | 'repaired'
    | 'skipped_unconfigured'
    | 'topic_conflict'
    | 'stale_confirmation'
    | 'deferred_locked'
    | 'lock_lost'
    | 'failed'
  status: NotificationRegistrationStatus
  googleAccountId: string
  pubsubTopic: string | null
  existingThirdPartyTopic?: string | null
  notificationTypes?: string[]
  apiCallsMade: number
  patchCalled: boolean
  errorCode?: string | null
  errorMessage?: string | null
}

function asMetadataObject(meta: Json | null | undefined): Record<string, unknown> {
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    return { ...(meta as Record<string, unknown>) }
  }
  return {}
}

async function fetchRegistrationRow(
  adminSupabase: TypedSupabaseClient,
  workspaceId: string,
  normalizedAccountId: string
): Promise<NotificationRegistrationRow | null> {
  const { data } = await adminSupabase
    .from('google_notification_registrations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('google_account_id', normalizedAccountId)
    .maybeSingle()
  return (data as NotificationRegistrationRow | null) || null
}

async function acquireAccountLock(
  adminSupabase: TypedSupabaseClient,
  normalizedAccountId: string,
  lockOwner: string,
  leaseSeconds: number
): Promise<{ acquired: boolean; fenceToken: number | null; leaseExpiresAt: string | null }> {
  const { data, error } = await adminSupabase.rpc('acquire_google_account_registration_lock', {
    p_google_account_id: normalizedAccountId,
    p_lock_owner: lockOwner,
    p_lease_seconds: leaseSeconds,
  })
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    return { acquired: false, fenceToken: null, leaseExpiresAt: null }
  }
  const obj = data as Record<string, unknown>
  return {
    acquired: Boolean(obj.acquired),
    fenceToken: typeof obj.fence_token === 'number' ? obj.fence_token : null,
    leaseExpiresAt: typeof obj.lease_expires_at === 'string' ? obj.lease_expires_at : null,
  }
}

async function renewAccountLock(
  adminSupabase: TypedSupabaseClient,
  normalizedAccountId: string,
  lockOwner: string,
  fenceToken: number,
  leaseSeconds: number
): Promise<boolean> {
  const { data, error } = await adminSupabase.rpc('renew_google_account_registration_lock', {
    p_google_account_id: normalizedAccountId,
    p_lock_owner: lockOwner,
    p_fence_token: fenceToken,
    p_lease_seconds: leaseSeconds,
  })
  if (error) return false
  return data === true
}

async function releaseAccountLock(
  adminSupabase: TypedSupabaseClient,
  normalizedAccountId: string,
  lockOwner: string,
  fenceToken: number
): Promise<void> {
  try {
    await adminSupabase.rpc('release_google_account_registration_lock', {
      p_google_account_id: normalizedAccountId,
      p_lock_owner: lockOwner,
      p_fence_token: fenceToken,
    })
  } catch {
    // Non-blocking release; lease TTL guarantees recovery
  }
}

async function callGetWithSingle401Retry(
  adminSupabase: TypedSupabaseClient,
  workspaceId: string,
  normalizedAccountId: string,
  initialAccessToken: string,
  getTokenFn: typeof getValidGoogleAccessToken,
  getSettingFn: typeof getGoogleAccountNotificationSetting
): Promise<{
  result: GoogleNotificationSettingResult
  accessToken: string
  calls: number
  tokenError?: { message: string; revoked: boolean }
}> {
  let token = initialAccessToken
  let calls = 1
  let res = await getSettingFn(token, normalizedAccountId)

  if (!res.success && res.httpStatus === 401) {
    try {
      const refreshed = await getTokenFn(adminSupabase, workspaceId, { forceRefresh: true })
      token = refreshed.accessToken
      calls++
      res = await getSettingFn(token, normalizedAccountId)
    } catch (err: unknown) {
      const msg = sanitizeGoogleDiagnosticError(
        err instanceof Error ? err.message : 'Google token refresh failed'
      )
      const revoked =
        (err instanceof GoogleApiError && err.status === 'INVALID_GRANT') ||
        classifyNotificationFailure(401, 'invalid_grant', msg).category === 'revoked'
      return { result: res, accessToken: token, calls, tokenError: { message: msg, revoked } }
    }
  }

  return { result: res, accessToken: token, calls }
}

/**
 * Core idempotent account-scoped Google Business Profile Pub/Sub notification registration
 * and reconciliation workflow. Must be called with a server-side service_role client.
 */
export async function ensureGoogleAccountNotificationsRegistered(
  adminSupabase: TypedSupabaseClient,
  params: EnsureNotificationRegistrationParams,
  deps?: NotificationRegistrationDeps
): Promise<NotificationRegistrationOutcome> {
  const nowMsFn = deps?.nowMs ?? (() => Date.now())
  const getTokenFn = deps?.getAccessToken ?? getValidGoogleAccessToken
  const getSettingFn = deps?.getSetting ?? getGoogleAccountNotificationSetting
  const updateSettingFn = deps?.updateSetting ?? updateGoogleAccountNotificationSetting
  const recordHealthFn = deps?.recordHealth ?? recordGoogleConnectionHealth
  const lockOwnerGen =
    deps?.generateLockOwner ??
    ((src: string) => `${src}-${crypto.randomBytes(6).toString('hex')}`)

  const normalizedAccountId = normalizeGoogleAccountId(params.googleAccountId)
  const source: NotificationRegistrationSource = params.source ?? 'auto_registration'
  const leaseSeconds = params.leaseSeconds ?? DEFAULT_ACCOUNT_LOCK_LEASE_SECONDS
  const nowMs = nowMsFn()
  const nowIso = new Date(nowMs).toISOString()

  if (!params.workspaceId || !normalizedAccountId) {
    return {
      success: false,
      outcome: 'failed',
      status: 'failed',
      googleAccountId: normalizedAccountId,
      pubsubTopic: null,
      apiCallsMade: 0,
      patchCalled: false,
      errorCode: 'invalid_argument',
      errorMessage: 'Valid workspaceId and Google account ID are required.',
    }
  }

  // 0. Check environment topic configuration (never hardcode staging topic)
  const topicConfig = resolveConfiguredGooglePubSubTopic(deps?.configuredTopicOverride)
  if (!topicConfig.configured || !topicConfig.topic) {
    const existing = await fetchRegistrationRow(adminSupabase, params.workspaceId, normalizedAccountId)
    const prevMeta = asMetadataObject(existing?.metadata)
    // Preserve existing registered row if already verified; otherwise record skipped_unconfigured without burning attempts
    if (!existing || existing.status !== 'registered') {
      await adminSupabase.from('google_notification_registrations').upsert(
        {
          workspace_id: params.workspaceId,
          google_account_id: normalizedAccountId,
          pubsub_topic: null,
          notification_types: [...REQUIRED_GBP_NOTIFICATION_TYPES],
          status: 'skipped_unconfigured',
          source,
          attempts: existing?.attempts ?? 0,
          max_attempts: existing?.max_attempts ?? MAX_NOTIFICATION_RETRY_ATTEMPTS,
          next_retry_at: null,
          last_error_code: 'topic_unconfigured',
          last_error_message: sanitizeGoogleDiagnosticError(topicConfig.reason),
          metadata: { ...prevMeta, topicUnconfiguredAt: nowIso } as Json,
          updated_at: nowIso,
        },
        { onConflict: 'workspace_id,google_account_id' }
      )
    }

    return {
      success: false,
      outcome: 'skipped_unconfigured',
      status: existing?.status === 'registered' ? 'registered' : 'skipped_unconfigured',
      googleAccountId: normalizedAccountId,
      pubsubTopic: null,
      apiCallsMade: 0,
      patchCalled: false,
      errorCode: 'topic_unconfigured',
      errorMessage: topicConfig.reason,
    }
  }

  const targetTopic = topicConfig.topic

  // Layer 1 Idempotency: DB short-circuit within 24h when already registered to targetTopic
  const existingPreLock = await fetchRegistrationRow(
    adminSupabase,
    params.workspaceId,
    normalizedAccountId
  )
  if (
    !params.forceVerify &&
    existingPreLock &&
    existingPreLock.status === 'registered' &&
    existingPreLock.pubsub_topic === targetTopic &&
    hasRequiredNotificationTypes(existingPreLock.notification_types) &&
    existingPreLock.last_verified_at &&
    nowMs - Date.parse(existingPreLock.last_verified_at) < NOTIFICATION_VERIFICATION_FRESH_MS
  ) {
    return {
      success: true,
      outcome: 'already_registered',
      status: 'registered',
      googleAccountId: normalizedAccountId,
      pubsubTopic: targetTopic,
      notificationTypes: existingPreLock.notification_types,
      apiCallsMade: 0,
      patchCalled: false,
    }
  }

  // Acquire cross-process fenced account lock
  const lockOwner = lockOwnerGen(source)
  const lockRes = await acquireAccountLock(
    adminSupabase,
    normalizedAccountId,
    lockOwner,
    leaseSeconds
  )

  if (!lockRes.acquired || lockRes.fenceToken === null) {
    const retryAt = new Date(nowMs + LOCK_CONTENTION_RETRY_SECONDS * 1000).toISOString()
    const prevMeta = asMetadataObject(existingPreLock?.metadata)
    if (!existingPreLock || existingPreLock.status !== 'registered') {
      await adminSupabase.from('google_notification_registrations').upsert(
        {
          workspace_id: params.workspaceId,
          google_account_id: normalizedAccountId,
          pubsub_topic: targetTopic,
          notification_types:
            existingPreLock?.notification_types && existingPreLock.notification_types.length > 0
              ? existingPreLock.notification_types
              : [...REQUIRED_GBP_NOTIFICATION_TYPES],
          status: 'pending',
          source,
          attempts: existingPreLock?.attempts ?? 0,
          max_attempts: existingPreLock?.max_attempts ?? MAX_NOTIFICATION_RETRY_ATTEMPTS,
          next_retry_at: retryAt,
          last_error_code: 'lock_contention',
          last_error_message: 'Registration deferred briefly while another process updates this Google account.',
          metadata: { ...prevMeta, deferredDueToAccountLock: true, deferredAt: nowIso } as Json,
          updated_at: nowIso,
        },
        { onConflict: 'workspace_id,google_account_id' }
      )
    }

    return {
      success: false,
      outcome: 'deferred_locked',
      status: existingPreLock?.status === 'registered' ? 'registered' : 'pending',
      googleAccountId: normalizedAccountId,
      pubsubTopic: targetTopic,
      apiCallsMade: 0,
      patchCalled: false,
      errorCode: 'lock_contention',
      errorMessage: 'Registration deferred briefly while another process updates this Google account.',
    }
  }

  const fenceToken = lockRes.fenceToken
  let apiCallsMade = 0
  let patchCalled = false

  try {
    // Re-read DB row under lock (another process may have just completed)
    const existing = await fetchRegistrationRow(
      adminSupabase,
      params.workspaceId,
      normalizedAccountId
    )
    const prevMeta = asMetadataObject(existing?.metadata)
    const baseAttempts = params.resetAttempts ? 0 : (existing?.attempts ?? 0)
    const maxAttempts = existing?.max_attempts ?? MAX_NOTIFICATION_RETRY_ATTEMPTS

    if (
      !params.forceVerify &&
      existing &&
      existing.status === 'registered' &&
      existing.pubsub_topic === targetTopic &&
      hasRequiredNotificationTypes(existing.notification_types) &&
      existing.last_verified_at &&
      nowMsFn() - Date.parse(existing.last_verified_at) < NOTIFICATION_VERIFICATION_FRESH_MS
    ) {
      return {
        success: true,
        outcome: 'already_registered',
        status: 'registered',
        googleAccountId: normalizedAccountId,
        pubsubTopic: targetTopic,
        notificationTypes: existing.notification_types,
        apiCallsMade: 0,
        patchCalled: false,
      }
    }

    // Obtain workspace's own OAuth access token (strictly per-workspace isolation)
    let accessToken: string
    try {
      const tokenInfo = await getTokenFn(adminSupabase, params.workspaceId)
      accessToken = tokenInfo.accessToken
    } catch (tokenErr: unknown) {
      const sanitizedMsg = sanitizeGoogleDiagnosticError(
        tokenErr instanceof Error ? tokenErr.message : 'Google OAuth token unavailable'
      )
      const isRevoked =
        (tokenErr instanceof GoogleApiError && tokenErr.status === 'INVALID_GRANT') ||
        classifyNotificationFailure(401, 'invalid_grant', sanitizedMsg).category === 'revoked'

      const nextAttempts = baseAttempts + 1
      const errCode = isRevoked ? 'revoked' : 'transient_google_error'
      const nextRetryAt =
        !isRevoked && nextAttempts < maxAttempts
          ? computeNotificationRetryAt(nextAttempts, nowMsFn())
          : null

      if (isRevoked) {
        await recordHealthFn(adminSupabase, params.workspaceId, {
          status: 'revoked',
          tokenStored: true,
          lastErrorCode: 'revoked',
          lastErrorMessage: sanitizedMsg,
        })
      }

      await adminSupabase.from('google_notification_registrations').upsert(
        {
          workspace_id: params.workspaceId,
          google_account_id: normalizedAccountId,
          pubsub_topic: targetTopic,
          notification_types:
            existing?.notification_types && existing.notification_types.length > 0
              ? existing.notification_types
              : [...REQUIRED_GBP_NOTIFICATION_TYPES],
          status: 'failed',
          source,
          attempts: nextAttempts,
          max_attempts: maxAttempts,
          next_retry_at: nextRetryAt,
          last_attempt_at: nowIso,
          last_http_status: 401,
          last_error_code: errCode,
          last_error_message: sanitizedMsg,
          metadata: { ...prevMeta, failedStage: 'oauth_token' } as Json,
          updated_at: nowIso,
        },
        { onConflict: 'workspace_id,google_account_id' }
      )

      return {
        success: false,
        outcome: 'failed',
        status: 'failed',
        googleAccountId: normalizedAccountId,
        pubsubTopic: targetTopic,
        apiCallsMade,
        patchCalled: false,
        errorCode: errCode,
        errorMessage: sanitizedMsg,
      }
    }

    // Layer 2: Always GET live Google setting first (with single 401 force-refresh retry)
    const getOutcome = await callGetWithSingle401Retry(
      adminSupabase,
      params.workspaceId,
      normalizedAccountId,
      accessToken,
      getTokenFn,
      getSettingFn
    )
    apiCallsMade += getOutcome.calls
    accessToken = getOutcome.accessToken

    if (getOutcome.tokenError || !getOutcome.result.success) {
      const rawErr = getOutcome.tokenError?.message || getOutcome.result.error || 'Failed to read GBP notificationSetting'
      const sanitizedMsg = sanitizeGoogleDiagnosticError(rawErr)
      const httpStatus = getOutcome.tokenError ? 401 : (getOutcome.result.httpStatus ?? 500)
      const classified = getOutcome.tokenError?.revoked
        ? { category: 'revoked' as const, retryable: false }
        : classifyNotificationFailure(httpStatus, getOutcome.result.errorCode, sanitizedMsg)

      const nextAttempts = baseAttempts + 1
      const nextRetryAt =
        classified.retryable && nextAttempts < maxAttempts
          ? computeNotificationRetryAt(nextAttempts, nowMsFn())
          : null

      if (classified.category === 'revoked') {
        await recordHealthFn(adminSupabase, params.workspaceId, {
          status: 'revoked',
          tokenStored: true,
          lastErrorCode: 'revoked',
          lastErrorMessage: sanitizedMsg,
        })
      }

      await adminSupabase.from('google_notification_registrations').upsert(
        {
          workspace_id: params.workspaceId,
          google_account_id: normalizedAccountId,
          pubsub_topic: targetTopic,
          notification_types:
            existing?.notification_types && existing.notification_types.length > 0
              ? existing.notification_types
              : [...REQUIRED_GBP_NOTIFICATION_TYPES],
          status: 'failed',
          source,
          attempts: nextAttempts,
          max_attempts: maxAttempts,
          next_retry_at: nextRetryAt,
          last_attempt_at: nowIso,
          last_http_status: httpStatus,
          last_error_code: classified.category,
          last_error_message: sanitizedMsg,
          metadata: {
            ...prevMeta,
            failedStage: 'get_notification_setting',
            endpointUsed: getOutcome.result.endpointUsed || 'mybusinessnotifications_v1',
          } as Json,
          updated_at: nowIso,
        },
        { onConflict: 'workspace_id,google_account_id' }
      )

      return {
        success: false,
        outcome: 'failed',
        status: 'failed',
        googleAccountId: normalizedAccountId,
        pubsubTopic: targetTopic,
        apiCallsMade,
        patchCalled: false,
        errorCode: classified.category,
        errorMessage: sanitizedMsg,
      }
    }

    const liveSetting = getOutcome.result.setting
    const plan = planNotificationPatch(liveSetting, targetTopic)

    // Case A: Already correctly configured -> 0 PATCH calls!
    if (plan.action === 'already_configured') {
      const effectiveSource: NotificationRegistrationSource = existing
        ? existing.source
        : 'reconciled_existing'
      const verifiedAt = new Date(nowMsFn()).toISOString()

      await adminSupabase.from('google_notification_registrations').upsert(
        {
          workspace_id: params.workspaceId,
          google_account_id: normalizedAccountId,
          pubsub_topic: targetTopic,
          notification_types: plan.mergedTypes,
          status: 'registered',
          source: effectiveSource,
          attempts: existing?.attempts ?? 0,
          max_attempts: maxAttempts,
          next_retry_at: null,
          last_attempt_at: verifiedAt,
          registered_at: existing?.registered_at || verifiedAt,
          last_verified_at: verifiedAt,
          last_http_status: getOutcome.result.httpStatus ?? 200,
          last_error_code: null,
          last_error_message: null,
          metadata: {
            ...prevMeta,
            reconciledWithoutPatch: true,
            endpointUsed: getOutcome.result.endpointUsed || 'mybusinessnotifications_v1',
          } as Json,
          updated_at: verifiedAt,
        },
        { onConflict: 'workspace_id,google_account_id' }
      )

      return {
        success: true,
        outcome: existing?.status === 'registered' ? 'already_registered' : 'reconciled_existing',
        status: 'registered',
        googleAccountId: normalizedAccountId,
        pubsubTopic: targetTopic,
        notificationTypes: plan.mergedTypes,
        apiCallsMade,
        patchCalled: false,
      }
    }

    // Case B: Unrelated third-party / other-environment topic -> fail-safe topic_conflict (0 PATCH calls!)
    if (plan.action === 'topic_conflict') {
      const conflictMsg =
        'This Google Business Profile account is already linked to a different Pub/Sub topic. Explicit owner/admin confirmation is required before replacing it.'
      const conflictAt = new Date(nowMsFn()).toISOString()

      await adminSupabase.from('google_notification_registrations').upsert(
        {
          workspace_id: params.workspaceId,
          google_account_id: normalizedAccountId,
          pubsub_topic: plan.existingTopic,
          notification_types: plan.mergedTypes,
          status: 'topic_conflict',
          source,
          attempts: existing?.attempts ?? 0,
          max_attempts: maxAttempts,
          next_retry_at: null,
          last_attempt_at: conflictAt,
          last_verified_at: conflictAt,
          last_http_status: getOutcome.result.httpStatus ?? 200,
          last_error_code: 'existing_third_party_topic',
          last_error_message: conflictMsg,
          metadata: {
            ...prevMeta,
            existingPubsubTopic: plan.existingTopic,
            targetPubsubTopic: targetTopic,
            driftDetectedAt: existing?.status === 'registered' ? conflictAt : prevMeta.driftDetectedAt,
          } as Json,
          updated_at: conflictAt,
        },
        { onConflict: 'workspace_id,google_account_id' }
      )

      return {
        success: false,
        outcome: 'topic_conflict',
        status: 'topic_conflict',
        googleAccountId: normalizedAccountId,
        pubsubTopic: plan.existingTopic,
        existingThirdPartyTopic: plan.existingTopic,
        notificationTypes: plan.mergedTypes,
        apiCallsMade,
        patchCalled: false,
        errorCode: 'existing_third_party_topic',
        errorMessage: conflictMsg,
      }
    }

    // Case C: Minimal-mask PATCH required -> MUST re-verify/renew fenced lock immediately before PATCH!
    if (plan.action !== 'patch_needed') {
      return {
        success: false,
        outcome: 'failed',
        status: 'failed',
        googleAccountId: normalizedAccountId,
        pubsubTopic: targetTopic,
        apiCallsMade,
        patchCalled: false,
        errorCode: 'unexpected_plan_state',
        errorMessage: 'Unexpected notification registration plan state.',
      }
    }

    const stillOwnsLock = await renewAccountLock(
      adminSupabase,
      normalizedAccountId,
      lockOwner,
      fenceToken,
      leaseSeconds
    )
    if (!stillOwnsLock) {
      return {
        success: false,
        outcome: 'lock_lost',
        status: existing?.status ?? 'pending',
        googleAccountId: normalizedAccountId,
        pubsubTopic: targetTopic,
        apiCallsMade,
        patchCalled: false,
        errorCode: 'lock_lost',
        errorMessage: 'Account registration lock expired before PATCH; aborted safely without writing.',
      }
    }

    apiCallsMade++
    patchCalled = true
    let patchRes = await updateSettingFn(
      accessToken,
      normalizedAccountId,
      plan.targetTopic,
      plan.mergedTypes,
      { updateMask: plan.updateMask }
    )

    // Layer 3: Single HTTP 401 force-refresh retry (with mandatory lock re-verification before retry PATCH)
    if (!patchRes.success && patchRes.httpStatus === 401) {
      try {
        const refreshed = await getTokenFn(adminSupabase, params.workspaceId, {
          forceRefresh: true,
        })
        accessToken = refreshed.accessToken

        const stillOwnsBeforeRetry = await renewAccountLock(
          adminSupabase,
          normalizedAccountId,
          lockOwner,
          fenceToken,
          leaseSeconds
        )
        if (!stillOwnsBeforeRetry) {
          return {
            success: false,
            outcome: 'lock_lost',
            status: existing?.status ?? 'pending',
            googleAccountId: normalizedAccountId,
            pubsubTopic: targetTopic,
            apiCallsMade,
            patchCalled,
            errorCode: 'lock_lost',
            errorMessage: 'Account registration lock expired before retry PATCH; aborted safely.',
          }
        }

        apiCallsMade++
        patchRes = await updateSettingFn(
          accessToken,
          normalizedAccountId,
          plan.targetTopic,
          plan.mergedTypes,
          { updateMask: plan.updateMask }
        )
      } catch (refreshErr: unknown) {
        const sanitizedMsg = sanitizeGoogleDiagnosticError(
          refreshErr instanceof Error ? refreshErr.message : 'Google token refresh failed'
        )
        const nextAttempts = baseAttempts + 1
        await recordHealthFn(adminSupabase, params.workspaceId, {
          status: 'revoked',
          tokenStored: true,
          lastErrorCode: 'revoked',
          lastErrorMessage: sanitizedMsg,
        })
        await adminSupabase.from('google_notification_registrations').upsert(
          {
            workspace_id: params.workspaceId,
            google_account_id: normalizedAccountId,
            pubsub_topic: targetTopic,
            notification_types: plan.mergedTypes,
            status: 'failed',
            source,
            attempts: nextAttempts,
            max_attempts: maxAttempts,
            next_retry_at: null,
            last_attempt_at: new Date(nowMsFn()).toISOString(),
            last_http_status: 401,
            last_error_code: 'revoked',
            last_error_message: sanitizedMsg,
            metadata: { ...prevMeta, failedStage: 'patch_token_refresh' } as Json,
            updated_at: new Date(nowMsFn()).toISOString(),
          },
          { onConflict: 'workspace_id,google_account_id' }
        )
        return {
          success: false,
          outcome: 'failed',
          status: 'failed',
          googleAccountId: normalizedAccountId,
          pubsubTopic: targetTopic,
          apiCallsMade,
          patchCalled,
          errorCode: 'revoked',
          errorMessage: sanitizedMsg,
        }
      }
    }

    const doneIso = new Date(nowMsFn()).toISOString()

    if (!patchRes.success) {
      const sanitizedMsg = sanitizeGoogleDiagnosticError(
        patchRes.error || 'Failed to update Google Business Profile notificationSetting'
      )
      const classified = classifyNotificationFailure(
        patchRes.httpStatus,
        patchRes.errorCode,
        sanitizedMsg
      )
      const nextAttempts = baseAttempts + 1
      const nextRetryAt =
        classified.retryable && nextAttempts < maxAttempts
          ? computeNotificationRetryAt(nextAttempts, nowMsFn())
          : null

      if (classified.category === 'revoked') {
        await recordHealthFn(adminSupabase, params.workspaceId, {
          status: 'revoked',
          tokenStored: true,
          lastErrorCode: 'revoked',
          lastErrorMessage: sanitizedMsg,
        })
      }

      await adminSupabase.from('google_notification_registrations').upsert(
        {
          workspace_id: params.workspaceId,
          google_account_id: normalizedAccountId,
          pubsub_topic: targetTopic,
          notification_types: plan.mergedTypes,
          status: 'failed',
          source,
          attempts: nextAttempts,
          max_attempts: maxAttempts,
          next_retry_at: nextRetryAt,
          last_attempt_at: doneIso,
          last_http_status: patchRes.httpStatus ?? 500,
          last_error_code: classified.category,
          last_error_message: sanitizedMsg,
          metadata: {
            ...prevMeta,
            failedStage: 'patch_notification_setting',
            updateMaskAttempted: plan.updateMask,
            endpointUsed: patchRes.endpointUsed || 'mybusinessnotifications_v1',
          } as Json,
          updated_at: doneIso,
        },
        { onConflict: 'workspace_id,google_account_id' }
      )

      return {
        success: false,
        outcome: 'failed',
        status: 'failed',
        googleAccountId: normalizedAccountId,
        pubsubTopic: targetTopic,
        apiCallsMade,
        patchCalled,
        errorCode: classified.category,
        errorMessage: sanitizedMsg,
      }
    }

    const finalTypes =
      Array.isArray(patchRes.setting?.notificationTypes) &&
      patchRes.setting.notificationTypes.length > 0
        ? patchRes.setting.notificationTypes
        : plan.mergedTypes

    await adminSupabase.from('google_notification_registrations').upsert(
      {
        workspace_id: params.workspaceId,
        google_account_id: normalizedAccountId,
        pubsub_topic: targetTopic,
        notification_types: finalTypes,
        status: 'registered',
        source,
        attempts: baseAttempts + 1,
        max_attempts: maxAttempts,
        next_retry_at: null,
        last_attempt_at: doneIso,
        registered_at: existing?.registered_at || doneIso,
        last_verified_at: doneIso,
        last_http_status: patchRes.httpStatus ?? 200,
        last_error_code: null,
        last_error_message: null,
        metadata: {
          ...prevMeta,
          reconciledWithoutPatch: false,
          updateMaskUsed: plan.updateMask,
          endpointUsed: patchRes.endpointUsed || 'mybusinessnotifications_v1',
          previousPubsubTopic: plan.previousTopic,
        } as Json,
        updated_at: doneIso,
      },
      { onConflict: 'workspace_id,google_account_id' }
    )

    return {
      success: true,
      outcome: existing?.status === 'registered' ? 'repaired' : 'registered',
      status: 'registered',
      googleAccountId: normalizedAccountId,
      pubsubTopic: targetTopic,
      notificationTypes: finalTypes,
      apiCallsMade,
      patchCalled,
    }
  } finally {
    await releaseAccountLock(adminSupabase, normalizedAccountId, lockOwner, fenceToken)
  }
}

export interface ConfirmTopicOverwriteParams {
  workspaceId: string
  googleAccountId: string
  actorUserId: string
  expectedCurrentTopic: string
  leaseSeconds?: number
}

/**
 * Explicit owner/admin third-party topic overwrite workflow (Section 8).
 * Never trusts allowTopicOverwrite blindly: acquires fenced account lock, performs a fresh
 * Google GET, compares current pubsubTopic strictly against expectedCurrentTopic, renews lock
 * before PATCH, preserves all existing valid notificationTypes, and records audit metadata.
 */
export async function confirmGoogleNotificationTopicOverwrite(
  adminSupabase: TypedSupabaseClient,
  params: ConfirmTopicOverwriteParams,
  deps?: NotificationRegistrationDeps
): Promise<NotificationRegistrationOutcome> {
  const nowMsFn = deps?.nowMs ?? (() => Date.now())
  const getTokenFn = deps?.getAccessToken ?? getValidGoogleAccessToken
  const getSettingFn = deps?.getSetting ?? getGoogleAccountNotificationSetting
  const updateSettingFn = deps?.updateSetting ?? updateGoogleAccountNotificationSetting
  const lockOwnerGen =
    deps?.generateLockOwner ??
    ((src: string) => `${src}-${crypto.randomBytes(6).toString('hex')}`)

  const normalizedAccountId = normalizeGoogleAccountId(params.googleAccountId)
  const expectedTopic = (params.expectedCurrentTopic || '').trim()
  const leaseSeconds = params.leaseSeconds ?? DEFAULT_ACCOUNT_LOCK_LEASE_SECONDS

  const topicConfig = resolveConfiguredGooglePubSubTopic(deps?.configuredTopicOverride)
  if (!topicConfig.configured || !topicConfig.topic) {
    return {
      success: false,
      outcome: 'skipped_unconfigured',
      status: 'skipped_unconfigured',
      googleAccountId: normalizedAccountId,
      pubsubTopic: null,
      apiCallsMade: 0,
      patchCalled: false,
      errorCode: 'topic_unconfigured',
      errorMessage: topicConfig.reason,
    }
  }

  if (!normalizedAccountId || !expectedTopic || !params.actorUserId) {
    return {
      success: false,
      outcome: 'failed',
      status: 'topic_conflict',
      googleAccountId: normalizedAccountId,
      pubsubTopic: null,
      apiCallsMade: 0,
      patchCalled: false,
      errorCode: 'invalid_argument',
      errorMessage: 'Account ID, actor user ID, and expected current topic are required to confirm overwrite.',
    }
  }

  const targetTopic = topicConfig.topic
  const lockOwner = lockOwnerGen('explicit_overwrite')
  const lockRes = await acquireAccountLock(
    adminSupabase,
    normalizedAccountId,
    lockOwner,
    leaseSeconds
  )

  if (!lockRes.acquired || lockRes.fenceToken === null) {
    return {
      success: false,
      outcome: 'deferred_locked',
      status: 'topic_conflict',
      googleAccountId: normalizedAccountId,
      pubsubTopic: expectedTopic,
      apiCallsMade: 0,
      patchCalled: false,
      errorCode: 'lock_contention',
      errorMessage: 'Another operation is currently updating this Google account. Please retry shortly.',
    }
  }

  const fenceToken = lockRes.fenceToken
  let apiCallsMade = 0
  let patchCalled = false

  try {
    const existing = await fetchRegistrationRow(
      adminSupabase,
      params.workspaceId,
      normalizedAccountId
    )
    const prevMeta = asMetadataObject(existing?.metadata)

    const tokenInfo = await getTokenFn(adminSupabase, params.workspaceId)
    const getOutcome = await callGetWithSingle401Retry(
      adminSupabase,
      params.workspaceId,
      normalizedAccountId,
      tokenInfo.accessToken,
      getTokenFn,
      getSettingFn
    )
    apiCallsMade += getOutcome.calls

    if (getOutcome.tokenError || !getOutcome.result.success) {
      const sanitizedMsg = sanitizeGoogleDiagnosticError(
        getOutcome.tokenError?.message || getOutcome.result.error || 'Failed to verify current Google topic'
      )
      return {
        success: false,
        outcome: 'failed',
        status: 'topic_conflict',
        googleAccountId: normalizedAccountId,
        pubsubTopic: expectedTopic,
        apiCallsMade,
        patchCalled: false,
        errorCode: getOutcome.tokenError?.revoked ? 'revoked' : 'get_failed',
        errorMessage: sanitizedMsg,
      }
    }

    const plan = planNotificationPatch(getOutcome.result.setting, targetTopic, {
      allowThirdPartyTopicOverwrite: true,
      expectedExistingTopic: expectedTopic,
    })

    const nowIso = new Date(nowMsFn()).toISOString()

    if (plan.action === 'already_configured') {
      await adminSupabase.from('google_notification_registrations').upsert(
        {
          workspace_id: params.workspaceId,
          google_account_id: normalizedAccountId,
          pubsub_topic: targetTopic,
          notification_types: plan.mergedTypes,
          status: 'registered',
          source: 'reconciled_existing',
          next_retry_at: null,
          last_attempt_at: nowIso,
          registered_at: existing?.registered_at || nowIso,
          last_verified_at: nowIso,
          last_http_status: 200,
          last_error_code: null,
          last_error_message: null,
          metadata: { ...prevMeta, reconciledWithoutPatch: true } as Json,
          updated_at: nowIso,
        },
        { onConflict: 'workspace_id,google_account_id' }
      )
      return {
        success: true,
        outcome: 'reconciled_existing',
        status: 'registered',
        googleAccountId: normalizedAccountId,
        pubsubTopic: targetTopic,
        notificationTypes: plan.mergedTypes,
        apiCallsMade,
        patchCalled: false,
      }
    }

    if (plan.action === 'stale_overwrite_confirmation') {
      const staleMsg =
        'The Google account notification topic changed since this confirmation was opened. Review the updated topic and confirm again.'
      await adminSupabase.from('google_notification_registrations').upsert(
        {
          workspace_id: params.workspaceId,
          google_account_id: normalizedAccountId,
          pubsub_topic: plan.existingTopic || null,
          notification_types: existing?.notification_types ?? [...REQUIRED_GBP_NOTIFICATION_TYPES],
          status: 'topic_conflict',
          source: existing?.source ?? 'auto_registration',
          next_retry_at: null,
          last_attempt_at: nowIso,
          last_verified_at: nowIso,
          last_error_code: 'stale_overwrite_confirmation',
          last_error_message: staleMsg,
          metadata: {
            ...prevMeta,
            existingPubsubTopic: plan.existingTopic,
            targetPubsubTopic: targetTopic,
          } as Json,
          updated_at: nowIso,
        },
        { onConflict: 'workspace_id,google_account_id' }
      )
      return {
        success: false,
        outcome: 'stale_confirmation',
        status: 'topic_conflict',
        googleAccountId: normalizedAccountId,
        pubsubTopic: plan.existingTopic || null,
        existingThirdPartyTopic: plan.existingTopic || null,
        apiCallsMade,
        patchCalled: false,
        errorCode: 'stale_overwrite_confirmation',
        errorMessage: staleMsg,
      }
    }

    if (plan.action !== 'patch_needed') {
      return {
        success: false,
        outcome: 'topic_conflict',
        status: 'topic_conflict',
        googleAccountId: normalizedAccountId,
        pubsubTopic: expectedTopic,
        apiCallsMade,
        patchCalled: false,
        errorCode: 'existing_third_party_topic',
        errorMessage: 'Overwrite confirmation could not proceed.',
      }
    }

    // Re-check & renew fenced lock immediately before PATCH
    const stillOwnsLock = await renewAccountLock(
      adminSupabase,
      normalizedAccountId,
      lockOwner,
      fenceToken,
      leaseSeconds
    )
    if (!stillOwnsLock) {
      return {
        success: false,
        outcome: 'lock_lost',
        status: 'topic_conflict',
        googleAccountId: normalizedAccountId,
        pubsubTopic: expectedTopic,
        apiCallsMade,
        patchCalled: false,
        errorCode: 'lock_lost',
        errorMessage: 'Account registration lock expired before PATCH; aborted safely.',
      }
    }

    apiCallsMade++
    patchCalled = true
    const patchRes = await updateSettingFn(
      getOutcome.accessToken,
      normalizedAccountId,
      plan.targetTopic,
      plan.mergedTypes,
      { updateMask: plan.updateMask }
    )

    const doneIso = new Date(nowMsFn()).toISOString()
    if (!patchRes.success) {
      const sanitizedMsg = sanitizeGoogleDiagnosticError(
        patchRes.error || 'Failed to replace Google Business Profile Pub/Sub topic'
      )
      return {
        success: false,
        outcome: 'failed',
        status: 'topic_conflict',
        googleAccountId: normalizedAccountId,
        pubsubTopic: expectedTopic,
        apiCallsMade,
        patchCalled,
        errorCode: patchRes.errorCode || 'patch_failed',
        errorMessage: sanitizedMsg,
      }
    }

    const finalTypes =
      Array.isArray(patchRes.setting?.notificationTypes) &&
      patchRes.setting.notificationTypes.length > 0
        ? patchRes.setting.notificationTypes
        : plan.mergedTypes

    await adminSupabase.from('google_notification_registrations').upsert(
      {
        workspace_id: params.workspaceId,
        google_account_id: normalizedAccountId,
        pubsub_topic: targetTopic,
        notification_types: finalTypes,
        status: 'registered',
        source: 'explicit_overwrite',
        attempts: (existing?.attempts ?? 0) + 1,
        max_attempts: existing?.max_attempts ?? MAX_NOTIFICATION_RETRY_ATTEMPTS,
        next_retry_at: null,
        last_attempt_at: doneIso,
        registered_at: doneIso,
        last_verified_at: doneIso,
        last_http_status: patchRes.httpStatus ?? 200,
        last_error_code: null,
        last_error_message: null,
        metadata: {
          ...prevMeta,
          reconciledWithoutPatch: false,
          updateMaskUsed: plan.updateMask,
          previousPubsubTopic: expectedTopic,
          explicitOverwriteConfirmedByUserId: params.actorUserId,
          explicitOverwriteConfirmedAt: doneIso,
        } as Json,
        updated_at: doneIso,
      },
      { onConflict: 'workspace_id,google_account_id' }
    )

    return {
      success: true,
      outcome: 'registered',
      status: 'registered',
      googleAccountId: normalizedAccountId,
      pubsubTopic: targetTopic,
      notificationTypes: finalTypes,
      apiCallsMade,
      patchCalled,
    }
  } finally {
    await releaseAccountLock(adminSupabase, normalizedAccountId, lockOwner, fenceToken)
  }
}

export interface ReconcileNotificationRegistrationsSummary {
  skippedUnconfigured: boolean
  scanned: number
  registered: number
  reconciledWithoutPatch: number
  repaired: number
  conflicts: number
  deferredLocked: number
  failed: number
}

/**
 * Throttled worker reconciliation & 24-hour drift detection pass.
 * Reconciles due pending/failed rows, skipped_unconfigured rows once configured,
 * unrecorded active legacy connected accounts, and registered rows > 24h since last verification.
 * Always executes sequentially per google_account_id and isolates failures from scheduled replies.
 */
export async function reconcileWorkspaceNotificationRegistrations(
  adminSupabase: TypedSupabaseClient,
  options?: { limit?: number },
  deps?: NotificationRegistrationDeps
): Promise<ReconcileNotificationRegistrationsSummary> {
  const summary: ReconcileNotificationRegistrationsSummary = {
    skippedUnconfigured: false,
    scanned: 0,
    registered: 0,
    reconciledWithoutPatch: 0,
    repaired: 0,
    conflicts: 0,
    deferredLocked: 0,
    failed: 0,
  }

  const topicConfig = resolveConfiguredGooglePubSubTopic(deps?.configuredTopicOverride)
  if (!topicConfig.configured || !topicConfig.topic) {
    summary.skippedUnconfigured = true
    return summary
  }

  const nowMs = (deps?.nowMs ?? (() => Date.now()))()
  const nowIso = new Date(nowMs).toISOString()
  const staleVerifyCutoffIso = new Date(nowMs - NOTIFICATION_VERIFICATION_FRESH_MS).toISOString()
  const maxBatch = Math.max(1, Math.min(10, options?.limit ?? 5))

  type Candidate = {
    workspaceId: string
    googleAccountId: string
    source: NotificationRegistrationSource
    forceVerify: boolean
  }

  const candidates: Candidate[] = []
  const seenKeys = new Set<string>()

  const addCandidate = (c: Candidate) => {
    const normAcc = normalizeGoogleAccountId(c.googleAccountId)
    if (!c.workspaceId || !normAcc) return
    const key = `${c.workspaceId}::${normAcc}`
    if (seenKeys.has(key) || candidates.length >= maxBatch) return
    seenKeys.add(key)
    candidates.push({ ...c, googleAccountId: normAcc })
  }

  // 1. Due pending, failed (attempts < max_attempts), and skipped_unconfigured rows
  const { data: retryRows } = await adminSupabase
    .from('google_notification_registrations')
    .select('workspace_id, google_account_id, status, attempts, max_attempts, next_retry_at')
    .in('status', ['pending', 'failed', 'skipped_unconfigured'])
    .limit(maxBatch * 2)

  for (const row of (retryRows || []) as Array<
    Pick<
      NotificationRegistrationRow,
      'workspace_id' | 'google_account_id' | 'status' | 'attempts' | 'max_attempts' | 'next_retry_at'
    >
  >) {
    if (row.status === 'skipped_unconfigured') {
      addCandidate({
        workspaceId: row.workspace_id,
        googleAccountId: row.google_account_id,
        source: 'worker_retry',
        forceVerify: true,
      })
      continue
    }

    if (row.status === 'failed' && row.attempts >= row.max_attempts) {
      continue
    }

    if (row.next_retry_at && Date.parse(row.next_retry_at) > nowMs) {
      continue
    }

    // Revoked/non-retryable failed rows have next_retry_at = null after >=1 attempt
    if (row.status === 'failed' && row.attempts > 0 && row.next_retry_at === null) {
      continue
    }

    addCandidate({
      workspaceId: row.workspace_id,
      googleAccountId: row.google_account_id,
      source: 'worker_retry',
      forceVerify: true,
    })
  }

  // 2. Active connected legacy locations with no registration row yet
  if (candidates.length < maxBatch) {
    const { data: activeLocs } = await adminSupabase
      .from('locations')
      .select('workspace_id, google_account_id')
      .eq('is_connected', true)
      .not('google_account_id', 'is', null)
      .limit(maxBatch * 2)

    if (activeLocs && activeLocs.length > 0) {
      const wsIds = Array.from(new Set(activeLocs.map((l) => l.workspace_id)))
      const { data: existingRegs } = await adminSupabase
        .from('google_notification_registrations')
        .select('workspace_id, google_account_id')
        .in('workspace_id', wsIds)

      const existingSet = new Set(
        (existingRegs || []).map(
          (r) => `${r.workspace_id}::${normalizeGoogleAccountId(r.google_account_id)}`
        )
      )

      for (const loc of activeLocs) {
        const normAcc = normalizeGoogleAccountId(loc.google_account_id)
        if (!normAcc) continue
        if (!existingSet.has(`${loc.workspace_id}::${normAcc}`)) {
          addCandidate({
            workspaceId: loc.workspace_id,
            googleAccountId: normAcc,
            source: 'reconciled_existing',
            forceVerify: true,
          })
        }
      }
    }
  }

  // 3. Registered rows needing 24-hour drift verification
  if (candidates.length < maxBatch) {
    const { data: driftRows } = await adminSupabase
      .from('google_notification_registrations')
      .select('workspace_id, google_account_id, last_verified_at')
      .eq('status', 'registered')
      .or(`last_verified_at.is.null,last_verified_at.lt.${staleVerifyCutoffIso}`)
      .limit(maxBatch)

    for (const row of (driftRows || []) as Array<
      Pick<NotificationRegistrationRow, 'workspace_id' | 'google_account_id' | 'last_verified_at'>
    >) {
      addCandidate({
        workspaceId: row.workspace_id,
        googleAccountId: row.google_account_id,
        source: 'worker_retry',
        forceVerify: true,
      })
    }
  }

  // Sort by google_account_id so shared-account workspaces execute sequentially
  candidates.sort((a, b) => a.googleAccountId.localeCompare(b.googleAccountId))
  summary.scanned = candidates.length

  for (const cand of candidates) {
    try {
      const res = await ensureGoogleAccountNotificationsRegistered(
        adminSupabase,
        {
          workspaceId: cand.workspaceId,
          googleAccountId: cand.googleAccountId,
          source: cand.source,
          forceVerify: cand.forceVerify,
        },
        deps
      )

      if (res.outcome === 'reconciled_existing' || res.outcome === 'already_registered') {
        summary.reconciledWithoutPatch++
      } else if (res.outcome === 'registered') {
        summary.registered++
      } else if (res.outcome === 'repaired') {
        summary.repaired++
      } else if (res.outcome === 'topic_conflict') {
        summary.conflicts++
      } else if (res.outcome === 'deferred_locked' || res.outcome === 'lock_lost') {
        summary.deferredLocked++
      } else {
        summary.failed++
      }
    } catch {
      summary.failed++
    }
  }

  void nowIso
  return summary
}
