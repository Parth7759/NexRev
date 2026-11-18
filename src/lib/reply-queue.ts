import crypto from 'crypto'
import { NextRequest } from 'next/server'
import type { Database, Json } from '@/types/database.types'
import {
  TypedSupabaseClient,
  getWorkspaceReplySettings,
  findExistingReviewReply,
  logReplyAudit,
} from '@/lib/reply-safety'
import {
  getValidGoogleAccessToken,
  fetchSingleGoogleReview,
  getGoogleAccountNotificationSetting,
} from '@/lib/google-business'
import { autoProcessSingleReview } from '@/lib/reply-automation'
import { verifyGooglePubSubOidcToken, VerifyOidcOptions } from '@/lib/google-pubsub-auth'

export type ReviewReplyJobRow = Database['public']['Tables']['review_reply_jobs']['Row']
export type GoogleConnectionHealthStatus =
  Database['public']['Tables']['google_connection_health']['Row']['status']

export interface EnqueueReplyJobParams {
  workspaceId: string
  locationId: string
  reviewId: string
  externalReviewId: string
  sourceEventId: string
  sourceEventType: 'NEW_REVIEW' | 'UPDATED_REVIEW' | 'SYNC_RECONCILIATION'
  maxAttempts?: number
  metadata?: Record<string, unknown>
  nowMs?: number
}

export interface EnqueueReplyJobResult {
  success: boolean
  enqueued: boolean
  deduplicated: boolean
  reason: string
  jobId: string | null
  status: string | null
  scheduledFor: string | null
  delayMinutes: number
  error?: string
}

export interface WorkerAuthResult {
  authenticated: boolean
  status?: number
  error?: string
  triggerSource?: 'cloud_scheduler_oidc' | 'bearer_cron_secret'
  serviceAccount?: string
}

export interface WorkerRunSummary {
  success: boolean
  workerId: string
  runId: string | null
  claimed: number
  published: number
  draftsSaved: number
  skipped: number
  deferred: number
  failed: number
  deadLettered: number
  healthProbesRun: number
  errors: Array<{ jobId: string; reviewId: string; error: string }>
}

/**
 * Pure helper: computes UTC ISO timestamp for scheduled_for given workspace delay.
 */
export function computeScheduledFor(delayMinutes: number, nowMs: number = Date.now()): string {
  const safeDelay = Number.isFinite(delayMinutes) ? Math.max(0, Math.floor(delayMinutes)) : 5
  return new Date(nowMs + safeDelay * 60_000).toISOString()
}

/**
 * Pure helper: strictly enforces that a job cannot execute before scheduled_for.
 */
export function isJobDueForExecution(
  scheduledForIso: string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!scheduledForIso) return false
  const scheduledMs = Date.parse(scheduledForIso)
  if (!Number.isFinite(scheduledMs)) return false
  return scheduledMs <= nowMs
}

/**
 * Pure helper: computes exponential backoff next retry timestamp (2m, 4m, 8m, 16m, ... capped at 60m).
 */
export function computeNextRetryAt(attempts: number, nowMs: number = Date.now()): string {
  const safeAttempts = Math.max(1, Math.floor(attempts))
  const backoffMinutes = Math.min(60, Math.pow(2, safeAttempts))
  return new Date(nowMs + backoffMinutes * 60_000).toISOString()
}

/**
 * Classifies Google API / OAuth errors into actionable retry vs permanent categories.
 */
export function classifyGoogleError(
  errorMsg: string | null | undefined
): 'not_found' | 'revoked' | 'permission_denied' | 'transient' {
  const msg = (errorMsg || '').toLowerCase()
  if (
    msg.includes('404') ||
    msg.includes('not_found') ||
    msg.includes('requested entity was not found')
  ) {
    return 'not_found'
  }
  if (
    msg.includes('invalid_grant') ||
    msg.includes('unauthorized_client') ||
    msg.includes('token has been expired or revoked') ||
    msg.includes('revoked or expired') ||
    msg.includes('authorization has been revoked') ||
    msg.includes('reconnect google') ||
    msg.includes('reconnect your google') ||
    msg.includes('no refresh token') ||
    msg.includes('401') ||
    msg.includes('unauthenticated')
  ) {
    return 'revoked'
  }
  if (
    msg.includes('403') ||
    msg.includes('permission_denied') ||
    msg.includes('access_token_scope_insufficient')
  ) {
    return 'permission_denied'
  }
  return 'transient'
}

/**
 * Constant-time string comparison for static secret fallback.
 */
function timingSafeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8')
  const bBuf = Buffer.from(b, 'utf8')
  if (aBuf.length !== bBuf.length) {
    return false
  }
  return crypto.timingSafeEqual(aBuf, bBuf)
}

/**
 * Authenticates requests to POST /api/workers/process-scheduled-replies.
 *
 * Security rules:
 * - Never accepts secrets in URL query parameters.
 * - When GOOGLE_SCHEDULER_WORKER_AUDIENCE or GOOGLE_SCHEDULER_WORKER_SERVICE_ACCOUNT is configured,
 *   STRICTLY requires a valid Google-signed OIDC Bearer JWT matching that dedicated audience and service account.
 *   (Pub/Sub tokens from pubsub-invoker are rejected with HTTP 401.)
 * - Only falls back to Authorization: Bearer <CRON_SECRET> when OIDC worker env vars are unset.
 */
export async function authenticateSchedulerWorkerRequest(
  request: NextRequest,
  options?: { keyResolver?: VerifyOidcOptions['keyResolver'] }
): Promise<WorkerAuthResult> {
  const url = new URL(request.url)
  if (url.searchParams.has('secret') || url.searchParams.has('token')) {
    return {
      authenticated: false,
      status: 401,
      error: 'Unauthorized: Query string credentials are not permitted on worker endpoint.',
    }
  }

  const workerAudience = process.env.GOOGLE_SCHEDULER_WORKER_AUDIENCE?.trim() || ''
  const workerServiceAccount = process.env.GOOGLE_SCHEDULER_WORKER_SERVICE_ACCOUNT?.trim() || ''
  const oidcRequired = Boolean(workerAudience || workerServiceAccount)

  const authHeader = request.headers.get('authorization') || ''
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''

  if (oidcRequired) {
    if (!workerAudience || !workerServiceAccount) {
      return {
        authenticated: false,
        status: 500,
        error:
          'Server misconfiguration: Both GOOGLE_SCHEDULER_WORKER_AUDIENCE and GOOGLE_SCHEDULER_WORKER_SERVICE_ACCOUNT must be configured.',
      }
    }

    if (!bearerToken) {
      return {
        authenticated: false,
        status: 401,
        error: 'Unauthorized: Missing required Google Cloud Scheduler OIDC Bearer token.',
      }
    }

    const oidcResult = await verifyGooglePubSubOidcToken(bearerToken, {
      audience: workerAudience,
      expectedServiceAccount: workerServiceAccount,
      keyResolver: options?.keyResolver,
    })

    if (!oidcResult.valid) {
      return {
        authenticated: false,
        status: 401,
        error: `Unauthorized: Invalid worker OIDC token (${oidcResult.error || 'verification failed'})`,
      }
    }

    return {
      authenticated: true,
      triggerSource: 'cloud_scheduler_oidc',
      serviceAccount: oidcResult.claims?.email,
    }
  }

  // Fallback when OIDC worker env vars are not set (e.g., local dev testing)
  const cronSecret = process.env.CRON_SECRET?.trim() || ''
  if (!cronSecret) {
    return {
      authenticated: false,
      status: 500,
      error:
        'Server misconfiguration: Configure GOOGLE_SCHEDULER_WORKER_AUDIENCE/SERVICE_ACCOUNT or CRON_SECRET.',
    }
  }

  if (!bearerToken || !timingSafeEqualString(bearerToken, cronSecret)) {
    return {
      authenticated: false,
      status: 401,
      error: 'Unauthorized: Invalid or missing worker Bearer token.',
    }
  }

  return {
    authenticated: true,
    triggerSource: 'bearer_cron_secret',
  }
}

/**
 * Non-blocking upsert into public.google_connection_health.
 */
export async function recordGoogleConnectionHealth(
  supabase: TypedSupabaseClient,
  workspaceId: string,
  update: {
    status: GoogleConnectionHealthStatus
    tokenStored?: boolean
    hasRequiredScope?: boolean
    lastRefreshSucceededAt?: string | null
    lastGbpApiVerifiedAt?: string | null
    lastErrorCode?: string | null
    lastErrorMessage?: string | null
    metadata?: Record<string, unknown>
  }
): Promise<void> {
  try {
    const nowIso = new Date().toISOString()
    const payload: Database['public']['Tables']['google_connection_health']['Insert'] = {
      workspace_id: workspaceId,
      status: update.status,
      last_checked_at: nowIso,
      updated_at: nowIso,
      last_error_code: update.lastErrorCode ?? null,
      last_error_message: update.lastErrorMessage ?? null,
      metadata: (update.metadata || {}) as Json,
    }
    if (typeof update.tokenStored === 'boolean') payload.token_stored = update.tokenStored
    if (typeof update.hasRequiredScope === 'boolean') {
      payload.has_required_scope = update.hasRequiredScope
    }
    if (update.lastRefreshSucceededAt !== undefined) {
      payload.last_refresh_succeeded_at = update.lastRefreshSucceededAt
    }
    if (update.lastGbpApiVerifiedAt !== undefined) {
      payload.last_gbp_api_verified_at = update.lastGbpApiVerifiedAt
    }

    await supabase.from('google_connection_health').upsert(payload, {
      onConflict: 'workspace_id',
    })
  } catch (err) {
    console.warn('Failed to persist google_connection_health:', err)
  }
}

/**
 * Verifies real Google OAuth token refresh and read-only GBP API connectivity for a workspace.
 * Never reports 'connected_verified' solely from a stored database token row.
 */
export async function probeWorkspaceGoogleHealth(
  supabase: TypedSupabaseClient,
  workspaceId: string
): Promise<{ status: GoogleConnectionHealthStatus; error?: string }> {
  const { data: integration, error: integErr } = await supabase
    .from('google_integrations')
    .select('id, account_id, scope, refresh_token_encrypted, expires_at')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (integErr || !integration) {
    await recordGoogleConnectionHealth(supabase, workspaceId, {
      status: 'disconnected',
      tokenStored: false,
      hasRequiredScope: false,
      lastErrorCode: 'no_integration',
      lastErrorMessage: 'No Google Business Profile OAuth connection stored.',
    })
    return { status: 'disconnected', error: 'No Google integration stored.' }
  }

  const scopes = integration.scope ? integration.scope.split(' ') : []
  const hasBusinessManage = scopes.includes('https://www.googleapis.com/auth/business.manage')
  const hasRefreshToken = Boolean(integration.refresh_token_encrypted)

  if (!hasBusinessManage || !hasRefreshToken) {
    await recordGoogleConnectionHealth(supabase, workspaceId, {
      status: 'revoked',
      tokenStored: hasRefreshToken,
      hasRequiredScope: hasBusinessManage,
      lastErrorCode: !hasBusinessManage ? 'missing_scope' : 'missing_refresh_token',
      lastErrorMessage: !hasBusinessManage
        ? 'Missing required https://www.googleapis.com/auth/business.manage OAuth scope.'
        : 'Missing stored Google refresh token.',
    })
    return { status: 'revoked', error: 'Missing required scope or refresh token.' }
  }

  // Step 1: Verify valid access token (refreshing if needed)
  let accessToken: string
  let accountId: string | null = integration.account_id
  try {
    const tokenInfo = await getValidGoogleAccessToken(supabase, workspaceId)
    accessToken = tokenInfo.accessToken
    accountId = tokenInfo.accountId || accountId
  } catch (tokenErr: unknown) {
    const msg = tokenErr instanceof Error ? tokenErr.message : 'Google token refresh failed'
    const kind = classifyGoogleError(msg)
    const status: GoogleConnectionHealthStatus =
      kind === 'revoked' ? 'revoked' : 'refresh_failed'
    await recordGoogleConnectionHealth(supabase, workspaceId, {
      status,
      tokenStored: true,
      hasRequiredScope: true,
      lastErrorCode: kind,
      lastErrorMessage: msg,
    })
    return { status, error: msg }
  }

  const refreshVerifiedAt = new Date().toISOString()

  // Step 2: Live read-only GBP API probe (verifies real GBP API connectivity)
  try {
    if (accountId) {
      const notifRes = await getGoogleAccountNotificationSetting(accessToken, accountId)
      if (notifRes.success) {
        const verifiedAt = new Date().toISOString()
        await recordGoogleConnectionHealth(supabase, workspaceId, {
          status: 'connected_verified',
          tokenStored: true,
          hasRequiredScope: true,
          lastRefreshSucceededAt: refreshVerifiedAt,
          lastGbpApiVerifiedAt: verifiedAt,
          lastErrorCode: null,
          lastErrorMessage: null,
          metadata: {
            probedEndpoint: 'notificationSetting',
            pubsubTopicConfigured: Boolean(notifRes.setting?.pubsubTopic),
          },
        })
        return { status: 'connected_verified' }
      }

      const kind = classifyGoogleError(notifRes.error)
      const status: GoogleConnectionHealthStatus =
        kind === 'revoked' ? 'revoked' : 'api_error'
      await recordGoogleConnectionHealth(supabase, workspaceId, {
        status,
        tokenStored: true,
        hasRequiredScope: true,
        lastRefreshSucceededAt: refreshVerifiedAt,
        lastErrorCode: kind,
        lastErrorMessage: notifRes.error || 'GBP API notificationSetting probe failed',
      })
      return { status, error: notifRes.error }
    }

    // Fallback lightweight GBP Accounts API probe if account_id is not stored yet
    const accRes = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    })

    if (accRes.ok) {
      const verifiedAt = new Date().toISOString()
      await recordGoogleConnectionHealth(supabase, workspaceId, {
        status: 'connected_verified',
        tokenStored: true,
        hasRequiredScope: true,
        lastRefreshSucceededAt: refreshVerifiedAt,
        lastGbpApiVerifiedAt: verifiedAt,
        lastErrorCode: null,
        lastErrorMessage: null,
        metadata: { probedEndpoint: 'accounts' },
      })
      return { status: 'connected_verified' }
    }

    const errText = await accRes.text().catch(() => `HTTP ${accRes.status}`)
    const kind = classifyGoogleError(`${accRes.status} ${errText}`)
    const status: GoogleConnectionHealthStatus = kind === 'revoked' ? 'revoked' : 'api_error'
    await recordGoogleConnectionHealth(supabase, workspaceId, {
      status,
      tokenStored: true,
      hasRequiredScope: true,
      lastRefreshSucceededAt: refreshVerifiedAt,
      lastErrorCode: kind,
      lastErrorMessage: `GBP API probe HTTP ${accRes.status}`,
    })
    return { status, error: `GBP API probe HTTP ${accRes.status}` }
  } catch (apiErr: unknown) {
    const msg = apiErr instanceof Error ? apiErr.message : 'GBP API connectivity error'
    await recordGoogleConnectionHealth(supabase, workspaceId, {
      status: 'api_error',
      tokenStored: true,
      hasRequiredScope: true,
      lastRefreshSucceededAt: refreshVerifiedAt,
      lastErrorCode: 'network_error',
      lastErrorMessage: msg,
    })
    return { status: 'api_error', error: msg }
  }
}

/**
 * Atomically enqueues a delayed review reply job respecting workspace auto_reply_delay_minutes.
 * Delegates deduplication to PostgreSQL RPC enqueue_review_reply_job + partial unique index.
 */
export async function enqueueScheduledReplyJob(
  supabase: TypedSupabaseClient,
  params: EnqueueReplyJobParams
): Promise<EnqueueReplyJobResult> {
  const settings = await getWorkspaceReplySettings(supabase, params.workspaceId)
  const delayMinutes = Math.max(0, settings.autoReplyDelayMinutes ?? 5)
  const scheduledFor = computeScheduledFor(delayMinutes, params.nowMs)

  const { data, error } = await supabase.rpc('enqueue_review_reply_job', {
    p_workspace_id: params.workspaceId,
    p_location_id: params.locationId,
    p_review_id: params.reviewId,
    p_external_review_id: params.externalReviewId,
    p_source_event_id: params.sourceEventId,
    p_source_event_type: params.sourceEventType,
    p_scheduled_for: scheduledFor,
    p_max_attempts: params.maxAttempts ?? 5,
    p_metadata: {
      delayMinutes,
      autoReplyModeAtEnqueue: settings.autoReplyMode,
      ...(params.metadata || {}),
    } as Json,
  })

  if (error) {
    return {
      success: false,
      enqueued: false,
      deduplicated: false,
      reason: 'enqueue_rpc_failed',
      jobId: null,
      status: null,
      scheduledFor: null,
      delayMinutes,
      error: error.message,
    }
  }

  const parsed = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>

  return {
    success: true,
    enqueued: Boolean(parsed.enqueued),
    deduplicated: Boolean(parsed.deduplicated),
    reason: typeof parsed.reason === 'string' ? parsed.reason : 'scheduled',
    jobId: typeof parsed.job_id === 'string' ? parsed.job_id : null,
    status: typeof parsed.status === 'string' ? parsed.status : null,
    scheduledFor: typeof parsed.scheduled_for === 'string' ? parsed.scheduled_for : scheduledFor,
    delayMinutes,
  }
}

/**
 * Safely updates linked review_automation_events row after worker processing.
 */
async function syncEventStatusForJob(
  supabase: TypedSupabaseClient,
  job: ReviewReplyJobRow,
  update: {
    processingStatus: 'published' | 'draft_saved' | 'skipped' | 'failed'
    publishingStatus: 'published' | 'draft_saved' | 'skipped' | 'failed'
    aiGeneratedReply?: string | null
    errorMessage?: string | null
    metadata?: Record<string, unknown>
  }
): Promise<void> {
  if (!job.source_event_id) return
  try {
    await supabase
      .from('review_automation_events')
      .update({
        review_id: job.review_id,
        processing_status: update.processingStatus,
        publishing_status: update.publishingStatus,
        ai_generated_reply: update.aiGeneratedReply ?? null,
        retry_count: job.attempts,
        error_message: update.errorMessage ?? null,
        metadata: (update.metadata || {}) as Json,
        updated_at: new Date().toISOString(),
      })
      .eq('event_id', job.source_event_id)
  } catch (err) {
    console.warn('Non-blocking failure syncing review_automation_events for job:', job.id, err)
  }
}

export interface ProcessClaimedJobResult {
  outcome: 'published' | 'draft_saved' | 'skipped' | 'deferred_premature' | 'failed' | 'dead_letter'
  error?: string
  reason?: string
}

/**
 * Processes a single claimed review_reply_jobs row with strict delay enforcement,
 * live Google pre-checks, duplicate protection, and retry/dead-letter handling.
 */
export async function processSingleClaimedJob(
  supabase: TypedSupabaseClient,
  job: ReviewReplyJobRow,
  options?: { dryRun?: boolean; nowMs?: number }
): Promise<ProcessClaimedJobResult> {
  const nowMs = options?.nowMs ?? Date.now()
  const nowIso = new Date(nowMs).toISOString()
  const dryRun = Boolean(options?.dryRun)

  // Defense-in-depth Layer 3: NEVER generate or publish before scheduled_for
  if (!isJobDueForExecution(job.scheduled_for, nowMs)) {
    await supabase
      .from('review_reply_jobs')
      .update({
        status: 'scheduled',
        locked_at: null,
        locked_by: null,
        attempts: Math.max(0, job.attempts - 1),
        updated_at: nowIso,
      })
      .eq('id', job.id)

    return {
      outcome: 'deferred_premature',
      reason: `Deferred: scheduled_for (${job.scheduled_for}) has not elapsed yet.`,
    }
  }

  // Idempotency check: skip if review already has a published reply
  const existingReply = await findExistingReviewReply(supabase, job.review_id, job.workspace_id)
  if (existingReply && existingReply.status === 'published') {
    await supabase
      .from('review_reply_jobs')
      .update({
        status: 'skipped',
        locked_at: null,
        locked_by: null,
        processed_at: nowIso,
        last_error: null,
        updated_at: nowIso,
      })
      .eq('id', job.id)

    await syncEventStatusForJob(supabase, job, {
      processingStatus: 'skipped',
      publishingStatus: 'skipped',
      metadata: { jobId: job.id, reason: 'Review already has a published reply.' },
    })

    return { outcome: 'skipped', reason: 'Review already has a published reply.' }
  }

  // Live Google Business Profile pre-check before AI generation / publishing
  if (!dryRun) {
    const { data: locRow } = await supabase
      .from('locations')
      .select('id, google_account_id, google_location_id, is_connected')
      .eq('id', job.location_id)
      .maybeSingle()

    if (!locRow || !locRow.is_connected || !locRow.google_account_id || !locRow.google_location_id) {
      const msg = 'Location is disconnected or missing Google mapping.'
      await supabase
        .from('review_reply_jobs')
        .update({
          status: 'dead_letter',
          locked_at: null,
          locked_by: null,
          processed_at: nowIso,
          last_error: msg,
          updated_at: nowIso,
        })
        .eq('id', job.id)

      await syncEventStatusForJob(supabase, job, {
        processingStatus: 'failed',
        publishingStatus: 'failed',
        errorMessage: msg,
        metadata: { jobId: job.id, deadLetter: true },
      })

      return { outcome: 'dead_letter', error: msg }
    }

    let accessToken: string
    try {
      const tokenInfo = await getValidGoogleAccessToken(supabase, job.workspace_id)
      accessToken = tokenInfo.accessToken
    } catch (tokenErr: unknown) {
      const msg = tokenErr instanceof Error ? tokenErr.message : 'Google OAuth token refresh failed'
      const kind = classifyGoogleError(msg)

      await recordGoogleConnectionHealth(supabase, job.workspace_id, {
        status: kind === 'revoked' ? 'revoked' : 'refresh_failed',
        tokenStored: true,
        lastErrorCode: kind,
        lastErrorMessage: msg,
      })

      const isExhausted = kind === 'revoked' || job.attempts >= job.max_attempts
      const nextStatus = isExhausted ? 'dead_letter' : 'failed'

      await supabase
        .from('review_reply_jobs')
        .update({
          status: nextStatus,
          locked_at: null,
          locked_by: null,
          next_retry_at: isExhausted ? null : computeNextRetryAt(job.attempts, nowMs),
          processed_at: isExhausted ? nowIso : null,
          last_error: msg,
          updated_at: nowIso,
        })
        .eq('id', job.id)

      await syncEventStatusForJob(supabase, job, {
        processingStatus: 'failed',
        publishingStatus: 'failed',
        errorMessage: msg,
        metadata: { jobId: job.id, errorCategory: kind, deadLetter: isExhausted },
      })

      return { outcome: isExhausted ? 'dead_letter' : 'failed', error: msg }
    }

    const liveReviewRes = await fetchSingleGoogleReview(accessToken, {
      accountId: locRow.google_account_id,
      locationId: locRow.google_location_id,
      reviewId: job.external_review_id,
    })

    if (!liveReviewRes.success || !liveReviewRes.review) {
      const errMsg = liveReviewRes.error || 'Failed to verify review on Google Business Profile API'
      const kind = classifyGoogleError(errMsg)

      // 404 NOT_FOUND: permanently skip (never retry, never delete DB review record)
      if (kind === 'not_found') {
        await supabase
          .from('review_reply_jobs')
          .update({
            status: 'skipped',
            locked_at: null,
            locked_by: null,
            processed_at: nowIso,
            last_error: `Review unavailable on Google (404): ${errMsg}`,
            updated_at: nowIso,
          })
          .eq('id', job.id)

        await syncEventStatusForJob(supabase, job, {
          processingStatus: 'skipped',
          publishingStatus: 'skipped',
          errorMessage: `Review unavailable on Google (404): ${errMsg}`,
          metadata: { jobId: job.id, reason: 'google_review_not_found_404' },
        })

        return { outcome: 'skipped', reason: 'Google review not found (404).' }
      }

      if (kind === 'revoked' || kind === 'permission_denied') {
        await recordGoogleConnectionHealth(supabase, job.workspace_id, {
          status: kind === 'revoked' ? 'revoked' : 'api_error',
          tokenStored: true,
          lastErrorCode: kind,
          lastErrorMessage: errMsg,
        })
      }

      const isExhausted = kind === 'revoked' || job.attempts >= job.max_attempts
      const nextStatus = isExhausted ? 'dead_letter' : 'failed'

      await supabase
        .from('review_reply_jobs')
        .update({
          status: nextStatus,
          locked_at: null,
          locked_by: null,
          next_retry_at: isExhausted ? null : computeNextRetryAt(job.attempts, nowMs),
          processed_at: isExhausted ? nowIso : null,
          last_error: errMsg,
          updated_at: nowIso,
        })
        .eq('id', job.id)

      await syncEventStatusForJob(supabase, job, {
        processingStatus: 'failed',
        publishingStatus: 'failed',
        errorMessage: errMsg,
        metadata: { jobId: job.id, errorCategory: kind, deadLetter: isExhausted },
      })

      return { outcome: isExhausted ? 'dead_letter' : 'failed', error: errMsg }
    }

    // Live GBP API fetch succeeded -> refresh verified connection health
    await recordGoogleConnectionHealth(supabase, job.workspace_id, {
      status: 'connected_verified',
      tokenStored: true,
      hasRequiredScope: true,
      lastRefreshSucceededAt: nowIso,
      lastGbpApiVerifiedAt: nowIso,
      lastErrorCode: null,
      lastErrorMessage: null,
      metadata: { verifiedVia: 'worker_review_fetch' },
    })

    // Protect existing merchant reply posted directly on Google during the delay window
    if (liveReviewRes.review.reply?.comment) {
      await supabase
        .from('reviews')
        .update({
          status: 'answered',
          rating: liveReviewRes.review.rating,
          content: liveReviewRes.review.content,
          updated_at: nowIso,
        })
        .eq('id', job.review_id)

      await supabase.from('review_replies').upsert(
        {
          review_id: job.review_id,
          workspace_id: job.workspace_id,
          content: liveReviewRes.review.reply.comment,
          status: 'published',
          is_ai_generated: false,
          updated_at: nowIso,
        },
        { onConflict: 'review_id' }
      )

      await supabase
        .from('review_reply_jobs')
        .update({
          status: 'skipped',
          locked_at: null,
          locked_by: null,
          processed_at: nowIso,
          last_error: null,
          updated_at: nowIso,
        })
        .eq('id', job.id)

      await syncEventStatusForJob(supabase, job, {
        processingStatus: 'skipped',
        publishingStatus: 'skipped',
        metadata: {
          jobId: job.id,
          reason: 'Existing merchant reply detected directly on Google during delay window.',
        },
      })

      return {
        outcome: 'skipped',
        reason: 'Existing merchant reply detected directly on Google.',
      }
    }

    // Keep DB review text/rating fresh in case customer edited the review during the delay window
    const sentiment =
      liveReviewRes.review.rating >= 4
        ? 'positive'
        : liveReviewRes.review.rating === 3
          ? 'neutral'
          : 'negative'

    await supabase
      .from('reviews')
      .update({
        rating: liveReviewRes.review.rating,
        content: liveReviewRes.review.content,
        author_name: liveReviewRes.review.authorName,
        author_photo_url: liveReviewRes.review.authorPhotoUrl,
        review_date: liveReviewRes.review.reviewDate,
        sentiment,
        updated_at: nowIso,
      })
      .eq('id', job.review_id)
  }

  // Execute existing production automation engine (preserves all approval & safety policies)
  const processResult = await autoProcessSingleReview(supabase, {
    reviewId: job.review_id,
    workspaceId: job.workspace_id,
    dryRun,
  })

  await logReplyAudit(supabase, {
    workspaceId: job.workspace_id,
    reviewId: job.review_id,
    replyId: processResult.replyId || null,
    action:
      processResult.status === 'published'
        ? 'published'
        : !processResult.success && !processResult.skipped
          ? 'failed'
          : 'generated',
    content: processResult.replyContent || null,
    errorMessage: processResult.error || null,
    metadata: {
      delayedQueueWorker: true,
      jobId: job.id,
      scheduledFor: job.scheduled_for,
      attempt: job.attempts,
      status: processResult.status,
      requiresApproval: processResult.requiresApproval,
      dryRun,
    },
  })

  if (!processResult.success && !processResult.skipped) {
    const errMsg = processResult.error || 'Failed to process scheduled review reply'
    const kind = classifyGoogleError(errMsg)
    const isExhausted = kind === 'revoked' || job.attempts >= job.max_attempts
    const nextStatus = isExhausted ? 'dead_letter' : 'failed'

    await supabase
      .from('review_reply_jobs')
      .update({
        status: nextStatus,
        locked_at: null,
        locked_by: null,
        next_retry_at: isExhausted ? null : computeNextRetryAt(job.attempts, nowMs),
        processed_at: isExhausted ? nowIso : null,
        last_error: errMsg,
        updated_at: nowIso,
      })
      .eq('id', job.id)

    await syncEventStatusForJob(supabase, job, {
      processingStatus: 'failed',
      publishingStatus: 'failed',
      aiGeneratedReply: processResult.replyContent || null,
      errorMessage: errMsg,
      metadata: { jobId: job.id, errorCategory: kind, deadLetter: isExhausted },
    })

    return { outcome: isExhausted ? 'dead_letter' : 'failed', error: errMsg }
  }

  const finalJobStatus: 'published' | 'draft_saved' | 'skipped' =
    processResult.status === 'published'
      ? 'published'
      : processResult.skipped && !processResult.replyId
        ? 'skipped'
        : 'draft_saved'

  await supabase
    .from('review_reply_jobs')
    .update({
      status: finalJobStatus,
      locked_at: null,
      locked_by: null,
      processed_at: nowIso,
      last_error: null,
      updated_at: nowIso,
    })
    .eq('id', job.id)

  await syncEventStatusForJob(supabase, job, {
    processingStatus: finalJobStatus,
    publishingStatus: finalJobStatus,
    aiGeneratedReply: processResult.replyContent || null,
    metadata: {
      jobId: job.id,
      scheduledFor: job.scheduled_for,
      processedAt: nowIso,
      policyReason: processResult.reason,
      requiresApproval: processResult.requiresApproval,
    },
  })

  return { outcome: finalJobStatus, reason: processResult.reason }
}

/**
 * Executes a full scheduled worker tick:
 * 1. Records worker run heartbeat in public.automation_worker_runs.
 * 2. Atomically claims due jobs via claim_due_review_reply_jobs (FOR UPDATE SKIP LOCKED).
 * 3. Processes each due job safely.
 * 4. Runs throttled (every 15 min) read-only Google OAuth + GBP API health probes.
 * 5. Finalizes worker heartbeat record.
 */
export async function runScheduledReplyWorker(
  supabase: TypedSupabaseClient,
  options?: {
    workerId?: string
    triggerSource?: string
    limit?: number
    dryRun?: boolean
    skipHealthProbe?: boolean
    healthProbeIntervalMinutes?: number
    nowMs?: number
  }
): Promise<WorkerRunSummary> {
  const nowMs = options?.nowMs ?? Date.now()
  const workerId =
    options?.workerId || `worker-${nowMs}-${crypto.randomBytes(4).toString('hex')}`
  const triggerSource = options?.triggerSource || 'cloud_scheduler'
  const limit = Math.max(1, Math.min(50, options?.limit ?? 10))
  const dryRun = Boolean(options?.dryRun)
  const probeIntervalMs = (options?.healthProbeIntervalMinutes ?? 15) * 60_000

  let runId: string | null = null
  try {
    const { data: runRow } = await supabase
      .from('automation_worker_runs')
      .insert({
        worker_id: workerId,
        trigger_source: triggerSource,
        started_at: new Date(nowMs).toISOString(),
        status: 'running',
        metadata: { dryRun, limit } as Json,
      })
      .select('id')
      .single()
    runId = runRow?.id ?? null
  } catch (hbErr) {
    console.warn('Non-blocking failure creating worker run heartbeat:', hbErr)
  }

  const summary: WorkerRunSummary = {
    success: true,
    workerId,
    runId,
    claimed: 0,
    published: 0,
    draftsSaved: 0,
    skipped: 0,
    deferred: 0,
    failed: 0,
    deadLettered: 0,
    healthProbesRun: 0,
    errors: [],
  }

  try {
    // Atomically claim due jobs (enforces scheduled_for <= now() at DB level)
    const { data: claimedJobs, error: claimErr } = await supabase.rpc(
      'claim_due_review_reply_jobs',
      {
        p_worker_id: workerId,
        p_limit: limit,
        p_stale_lock_minutes: 10,
      }
    )

    if (claimErr) {
      throw new Error(`Failed to claim due review reply jobs: ${claimErr.message}`)
    }

    const jobs = Array.isArray(claimedJobs) ? claimedJobs : []
    summary.claimed = jobs.length

    for (const job of jobs) {
      try {
        const res = await processSingleClaimedJob(supabase, job, { dryRun, nowMs })
        if (res.outcome === 'published') summary.published++
        else if (res.outcome === 'draft_saved') summary.draftsSaved++
        else if (res.outcome === 'skipped') summary.skipped++
        else if (res.outcome === 'deferred_premature') summary.deferred++
        else if (res.outcome === 'dead_letter') {
          summary.deadLettered++
          summary.failed++
          summary.errors.push({
            jobId: job.id,
            reviewId: job.review_id,
            error: res.error || 'Dead-lettered job',
          })
        } else {
          summary.failed++
          summary.errors.push({
            jobId: job.id,
            reviewId: job.review_id,
            error: res.error || 'Job failed',
          })
        }
      } catch (jobErr: unknown) {
        const msg = jobErr instanceof Error ? jobErr.message : 'Unexpected job execution error'
        summary.failed++
        summary.errors.push({ jobId: job.id, reviewId: job.review_id, error: msg })
      }
    }

    // Throttled read-only Google OAuth + GBP API health probe for connected workspaces
    if (!options?.skipHealthProbe && !dryRun) {
      const { data: integrations } = await supabase
        .from('google_integrations')
        .select('workspace_id')

      if (integrations && integrations.length > 0) {
        const workspaceIds = [...new Set(integrations.map((i) => i.workspace_id))]
        const { data: existingHealth } = await supabase
          .from('google_connection_health')
          .select('workspace_id, last_checked_at')
          .in('workspace_id', workspaceIds)

        const healthMap = new Map<string, string | null>(
          (existingHealth || []).map((h) => [h.workspace_id, h.last_checked_at])
        )

        for (const wsId of workspaceIds) {
          const lastChecked = healthMap.get(wsId)
          const lastCheckedMs = lastChecked ? Date.parse(lastChecked) : 0
          if (!lastChecked || nowMs - lastCheckedMs >= probeIntervalMs) {
            await probeWorkspaceGoogleHealth(supabase, wsId)
            summary.healthProbesRun++
          }
        }
      }
    }

    if (runId) {
      await supabase
        .from('automation_worker_runs')
        .update({
          completed_at: new Date().toISOString(),
          status: 'succeeded',
          claimed_count: summary.claimed,
          published_count: summary.published,
          draft_count: summary.draftsSaved,
          skipped_count: summary.skipped,
          failed_count: summary.failed,
          metadata: {
            dryRun,
            deferred: summary.deferred,
            deadLettered: summary.deadLettered,
            healthProbesRun: summary.healthProbesRun,
          } as Json,
        })
        .eq('id', runId)
    }

    return summary
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Worker tick failed'
    summary.success = false
    summary.errors.push({ jobId: 'worker', reviewId: 'none', error: msg })

    if (runId) {
      await supabase
        .from('automation_worker_runs')
        .update({
          completed_at: new Date().toISOString(),
          status: 'failed',
          claimed_count: summary.claimed,
          published_count: summary.published,
          draft_count: summary.draftsSaved,
          skipped_count: summary.skipped,
          failed_count: summary.failed,
          error_message: msg,
        })
        .eq('id', runId)
    }

    return summary
  }
}
