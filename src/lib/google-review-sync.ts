import type { Json } from '@/types/database.types'
import { findExistingReviewReply, TypedSupabaseClient } from './reply-safety'
import {
  getValidGoogleAccessToken,
  fetchGoogleReviews,
  GoogleApiError,
  GoogleReviewData,
} from './google-business'
import { autoProcessSingleReview } from './reply-automation'
import { enqueueScheduledReplyJob } from './reply-queue'
import { sanitizeGoogleDiagnosticError } from './google-notification-registration'

export interface SyncWorkspaceReviewsResult {
  success: boolean
  workspaceId: string
  locationId?: string
  locationName?: string
  totalFetched: number
  newReviewsCount: number
  updatedReviewsCount: number
  unansweredCount: number
  negativeReviewsCount: number
  skippedReviewsCount: number
  failedReviewsCount?: number
  lastSyncedAt: string
  message: string
  error?: string
  errorCode?: string
}

export interface BatchSyncReviewsResult {
  success: boolean
  workspacesScanned: number
  workspacesSynced: number
  totalFetched: number
  newReviewsCount: number
  updatedReviewsCount: number
  unansweredCount: number
  negativeReviewsCount: number
  errors: Array<{ workspaceId: string; error: string }>
  lastSyncedAt: string
}

export interface SyncOptions {
  dryRun?: boolean
  userId?: string | null
  skipAutoReply?: boolean
}

export interface PersistCanonicalReviewResult {
  action: 'inserted' | 'updated' | 'skipped' | 'failed'
  reviewDbId: string | null
  externalReviewId: string
  hasEdited: boolean
  hasExternalReply: boolean
  effectiveStatus: 'answered' | 'unanswered'
  sentiment: 'positive' | 'neutral' | 'negative'
  error?: string
}

export interface FallbackReviewSyncOptions {
  dryRun?: boolean
  skipAutoReply?: boolean
  lookbackHours?: number
  maxPages?: number
  pageSize?: number
  nowMs?: number
}

export interface WorkspaceFallbackSyncMetrics {
  success: boolean
  workspaceId: string
  locationId?: string
  locationName?: string
  fetched: number
  inserted: number
  updated: number
  skipped: number
  enqueued: number
  deduplicatedJobs: number
  failed: number
  pagesFetched: number
  truncatedByLookback: boolean
  truncatedByMaxPages: boolean
  lookbackCutoffIso: string
  syncedAt: string
  error?: string
  errorCode?: string
}

export interface PeriodicFallbackSyncOptions {
  intervalMinutes?: number
  lookbackHours?: number
  maxWorkspacesPerTick?: number
  maxPagesPerWorkspace?: number
  pageSize?: number
  dryRun?: boolean
  skipAutoReply?: boolean
  force?: boolean
  workspaceIds?: string[]
  nowMs?: number
}

export interface PeriodicFallbackSyncSummary {
  success: boolean
  workspacesScanned: number
  workspacesEligible: number
  workspacesSynced: number
  workspacesThrottled: number
  workspacesFailed: number
  fetched: number
  inserted: number
  updated: number
  skipped: number
  enqueued: number
  deduplicatedJobs: number
  failed: number
  errors: Array<{ workspaceId: string; error: string; errorCode?: string }>
  results: WorkspaceFallbackSyncMetrics[]
  ranAt: string
}

interface FallbackHealthTelemetry {
  lastRunAt: string
  lastSucceededAt: string | null
  status: 'succeeded' | 'failed' | 'skipped'
  fetched: number
  inserted: number
  updated: number
  skipped: number
  enqueued: number
  deduplicatedJobs: number
  failed: number
  pagesFetched: number
  errorCode: string | null
  errorMessage: string | null
}

function asPlainObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) }
  }
  return {}
}

/**
 * Extracts the last fallback review sync run timestamp from google_connection_health.metadata.
 */
export function extractLastFallbackSyncRunAt(metadata: unknown): string | null {
  const root = asPlainObject(metadata)
  const syncBlock = asPlainObject(root.fallbackReviewSync)
  const lastRunAt = syncBlock.lastRunAt
  return typeof lastRunAt === 'string' && Number.isFinite(Date.parse(lastRunAt))
    ? lastRunAt
    : null
}

/**
 * Non-blocking update of fallback review sync health metrics inside google_connection_health.metadata.
 * Shallow-merges with existing metadata so health probe fields are always preserved.
 */
async function recordFallbackSyncHealthMetadata(
  supabase: TypedSupabaseClient,
  workspaceId: string,
  telemetry: Omit<FallbackHealthTelemetry, 'lastSucceededAt'> & { succeeded: boolean },
  nowIso: string
): Promise<void> {
  try {
    const { data: existingRow } = await supabase
      .from('google_connection_health')
      .select('workspace_id, status, metadata')
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    const existingMeta = asPlainObject(existingRow?.metadata)
    const prevBlock = asPlainObject(existingMeta.fallbackReviewSync)
    const prevSucceededAt =
      typeof prevBlock.lastSucceededAt === 'string' ? prevBlock.lastSucceededAt : null

    const nextBlock: FallbackHealthTelemetry = {
      lastRunAt: telemetry.lastRunAt,
      lastSucceededAt: telemetry.succeeded ? telemetry.lastRunAt : prevSucceededAt,
      status: telemetry.status,
      fetched: telemetry.fetched,
      inserted: telemetry.inserted,
      updated: telemetry.updated,
      skipped: telemetry.skipped,
      enqueued: telemetry.enqueued,
      deduplicatedJobs: telemetry.deduplicatedJobs,
      failed: telemetry.failed,
      pagesFetched: telemetry.pagesFetched,
      errorCode: telemetry.errorCode,
      errorMessage: telemetry.errorMessage,
    }

    const mergedMetadata = {
      ...existingMeta,
      fallbackReviewSync: nextBlock,
    } as unknown as Json

    if (existingRow?.workspace_id) {
      await supabase
        .from('google_connection_health')
        .update({
          metadata: mergedMetadata,
          updated_at: nowIso,
        })
        .eq('workspace_id', workspaceId)
    } else {
      await supabase.from('google_connection_health').upsert(
        {
          workspace_id: workspaceId,
          status: 'unknown',
          metadata: mergedMetadata,
          updated_at: nowIso,
        },
        { onConflict: 'workspace_id' }
      )
    }
  } catch (err) {
    console.warn('Non-blocking failure persisting fallback review sync health metadata:', err)
  }
}

/**
 * Canonical, idempotent, strictly tenant-scoped persistence for a single Google Business Profile review.
 *
 * Guarantees:
 * - Strictly scoped by (workspace_id, external_review_id).
 * - Never deletes historical reviews when Google omits them.
 * - Never downgrades an already 'answered' review back to 'unanswered'.
 * - Handles concurrent insert races (PostgreSQL 23505) idempotently.
 * - Syncs external Google merchant replies into review_replies without clobbering identical AI reply metadata.
 * - Never generates or publishes AI replies.
 */
export async function persistCanonicalGoogleReview(
  supabase: TypedSupabaseClient,
  params: {
    workspaceId: string
    locationId: string
    review: GoogleReviewData
    nowIso: string
    dryRun?: boolean
  }
): Promise<PersistCanonicalReviewResult> {
  const { workspaceId, locationId, review, nowIso, dryRun = false } = params
  const sentiment: 'positive' | 'neutral' | 'negative' =
    review.rating >= 4 ? 'positive' : review.rating === 3 ? 'neutral' : 'negative'
  const externalReplyComment = review.reply?.comment?.trim() || ''
  const hasExternalReply = externalReplyComment.length > 0
  const incomingStatus: 'unanswered' | 'answered' = hasExternalReply ? 'answered' : 'unanswered'

  const { data: existingReview, error: lookupError } = await supabase
    .from('reviews')
    .select('id, rating, content, author_name, author_photo_url, review_date, status, location_id')
    .eq('workspace_id', workspaceId)
    .eq('external_review_id', review.reviewId)
    .maybeSingle()

  if (lookupError) {
    return {
      action: 'failed',
      reviewDbId: null,
      externalReviewId: review.reviewId,
      hasEdited: false,
      hasExternalReply,
      effectiveStatus: incomingStatus,
      sentiment,
      error: `Failed to lookup existing review: ${lookupError.message}`,
    }
  }

  let reviewDbId: string | null = null
  let action: 'inserted' | 'updated' | 'skipped' = 'skipped'
  let hasEdited = false
  let effectiveStatus: 'answered' | 'unanswered' = incomingStatus

  if (existingReview?.id) {
    reviewDbId = existingReview.id
    effectiveStatus =
      hasExternalReply || existingReview.status === 'answered' ? 'answered' : 'unanswered'

    const existingDateMs = existingReview.review_date ? Date.parse(existingReview.review_date) : 0
    const revDateMs = review.reviewDate ? Date.parse(review.reviewDate) : 0
    hasEdited =
      existingReview.rating !== review.rating ||
      (existingReview.content || '') !== (review.content || '') ||
      (Number.isFinite(existingDateMs) &&
        Number.isFinite(revDateMs) &&
        Math.abs(existingDateMs - revDateMs) > 1000)

    const statusUpgradedToAnswered = hasExternalReply && existingReview.status !== 'answered'

    if (hasEdited || statusUpgradedToAnswered) {
      if (!dryRun) {
        const { error: updateError } = await supabase
          .from('reviews')
          .update({
            rating: review.rating,
            content: review.content,
            author_name: review.authorName,
            author_photo_url: review.authorPhotoUrl,
            review_date: review.reviewDate,
            sentiment,
            status: effectiveStatus,
            updated_at: nowIso,
          })
          .eq('id', existingReview.id)
          .eq('workspace_id', workspaceId)

        if (updateError) {
          return {
            action: 'failed',
            reviewDbId: existingReview.id,
            externalReviewId: review.reviewId,
            hasEdited,
            hasExternalReply,
            effectiveStatus,
            sentiment,
            error: `Failed to update review: ${updateError.message}`,
          }
        }
      }
      action = 'updated'
    } else {
      action = 'skipped'
    }
  } else {
    if (!dryRun) {
      const { data: insertedRev, error: insertError } = await supabase
        .from('reviews')
        .insert({
          workspace_id: workspaceId,
          location_id: locationId,
          author_name: review.authorName,
          author_photo_url: review.authorPhotoUrl,
          rating: review.rating,
          content: review.content,
          review_date: review.reviewDate,
          source: 'google',
          status: incomingStatus,
          sentiment,
          external_review_id: review.reviewId,
        })
        .select('id')
        .single()

      if (insertError) {
        // Handle concurrent insert race idempotently if DB unique constraint triggers
        const errCode = (insertError as { code?: string }).code
        if (errCode === '23505') {
          const { data: racedRow } = await supabase
            .from('reviews')
            .select('id, status')
            .eq('workspace_id', workspaceId)
            .eq('external_review_id', review.reviewId)
            .maybeSingle()

          reviewDbId = racedRow?.id ?? null
          effectiveStatus =
            hasExternalReply || racedRow?.status === 'answered' ? 'answered' : 'unanswered'
          action = 'skipped'
        } else {
          return {
            action: 'failed',
            reviewDbId: null,
            externalReviewId: review.reviewId,
            hasEdited: false,
            hasExternalReply,
            effectiveStatus: incomingStatus,
            sentiment,
            error: `Failed to insert review: ${insertError.message}`,
          }
        }
      } else if (insertedRev?.id) {
        reviewDbId = insertedRev.id
        action = 'inserted'
      }
    } else {
      action = 'inserted'
    }
  }

  // Synchronize Google-provided external reply if present (never overwrites identical AI reply metadata)
  if (reviewDbId && hasExternalReply && !dryRun) {
    const { data: existingReply } = await supabase
      .from('review_replies')
      .select('id, content, status')
      .eq('review_id', reviewDbId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (existingReply?.id) {
      if (existingReply.content !== externalReplyComment || existingReply.status !== 'published') {
        await supabase
          .from('review_replies')
          .update({
            content: externalReplyComment,
            status: 'published',
            updated_at: nowIso,
          })
          .eq('id', existingReply.id)
          .eq('workspace_id', workspaceId)
      }
    } else {
      await supabase.from('review_replies').insert({
        review_id: reviewDbId,
        workspace_id: workspaceId,
        content: externalReplyComment,
        is_ai_generated: false,
        status: 'published',
      })
    }
  }

  return {
    action,
    reviewDbId,
    externalReviewId: review.reviewId,
    hasEdited,
    hasExternalReply,
    effectiveStatus,
    sentiment,
  }
}

/**
 * Fetches reviews for a workspace with a single automatic forceRefresh retry on 401 INVALID_GRANT.
 */
async function fetchReviewsWithTokenRetry(
  supabase: TypedSupabaseClient,
  workspaceId: string,
  accountId: string,
  locationId: string,
  fetchOptions?: Parameters<typeof fetchGoogleReviews>[3]
) {
  const tokenResult = await getValidGoogleAccessToken(supabase, workspaceId)
  let reviewsResult = await fetchGoogleReviews(
    tokenResult.accessToken,
    accountId,
    locationId,
    fetchOptions
  )

  if (!reviewsResult.supported && reviewsResult.errorCode === 'INVALID_GRANT') {
    try {
      const refreshed = await getValidGoogleAccessToken(supabase, workspaceId, {
        forceRefresh: true,
      })
      reviewsResult = await fetchGoogleReviews(
        refreshed.accessToken,
        accountId,
        locationId,
        fetchOptions
      )
    } catch (refreshErr) {
      const msg =
        refreshErr instanceof Error
          ? refreshErr.message
          : 'Google authorization expired during reviews fetch.'
      return {
        supported: false,
        reviews: [],
        pagesFetched: reviewsResult.pagesFetched ?? 0,
        message: msg,
        errorCode: 'INVALID_GRANT' as const,
      }
    }
  }

  return reviewsResult
}

/**
 * Synchronizes Google Business Profile reviews for a specific workspace's single active connected profile.
 *
 * Used for initial profile connection backfill and manual dashboard syncs.
 * Defaults to `skipAutoReply = true` so historical/backfill imports NEVER auto-publish replies.
 */
export async function syncWorkspaceGoogleReviews(
  supabase: TypedSupabaseClient,
  workspaceId: string,
  options: SyncOptions = {}
): Promise<SyncWorkspaceReviewsResult> {
  const { dryRun = false, userId = null, skipAutoReply = true } = options
  const nowIso = new Date().toISOString()

  if (!workspaceId) {
    return {
      success: false,
      workspaceId: '',
      totalFetched: 0,
      newReviewsCount: 0,
      updatedReviewsCount: 0,
      unansweredCount: 0,
      negativeReviewsCount: 0,
      skippedReviewsCount: 0,
      failedReviewsCount: 0,
      lastSyncedAt: nowIso,
      message: 'Workspace ID is required.',
      error: 'Workspace ID is required.',
    }
  }

  // 1. Find the strictly active connected location for this workspace
  const { data: connectedLocations, error: locError } = await supabase
    .from('locations')
    .select('id, name, address, phone, google_location_id, google_account_id, is_connected, updated_at')
    .eq('workspace_id', workspaceId)
    .eq('is_connected', true)

  if (locError) {
    return {
      success: false,
      workspaceId,
      totalFetched: 0,
      newReviewsCount: 0,
      updatedReviewsCount: 0,
      unansweredCount: 0,
      negativeReviewsCount: 0,
      skippedReviewsCount: 0,
      failedReviewsCount: 0,
      lastSyncedAt: nowIso,
      message: 'Database error reading locations.',
      error: locError.message,
    }
  }

  if (!connectedLocations || connectedLocations.length === 0) {
    return {
      success: true,
      workspaceId,
      totalFetched: 0,
      newReviewsCount: 0,
      updatedReviewsCount: 0,
      unansweredCount: 0,
      negativeReviewsCount: 0,
      skippedReviewsCount: 0,
      failedReviewsCount: 0,
      lastSyncedAt: nowIso,
      message: 'Synchronization skipped: No business profile is connected for this workspace.',
      errorCode: 'NOT_CONNECTED',
    }
  }

  if (connectedLocations.length > 1) {
    return {
      success: false,
      workspaceId,
      totalFetched: 0,
      newReviewsCount: 0,
      updatedReviewsCount: 0,
      unansweredCount: 0,
      negativeReviewsCount: 0,
      skippedReviewsCount: 0,
      failedReviewsCount: 0,
      lastSyncedAt: nowIso,
      message: 'Automation stopped: Ambiguous profile selection (multiple profiles active). Exactly one profile must be selected.',
      error: 'Ambiguous profile selection. Exactly one profile must be selected.',
      errorCode: 'AMBIGUOUS_PROFILE',
    }
  }

  const activeLoc = connectedLocations[0]

  if (!activeLoc.google_location_id || !activeLoc.google_account_id) {
    return {
      success: false,
      workspaceId,
      locationId: activeLoc.id,
      locationName: activeLoc.name,
      totalFetched: 0,
      newReviewsCount: 0,
      updatedReviewsCount: 0,
      unansweredCount: 0,
      negativeReviewsCount: 0,
      skippedReviewsCount: 0,
      failedReviewsCount: 0,
      lastSyncedAt: nowIso,
      message: 'Connected business profile is missing Google Location or Account ID mapping.',
      error: 'Invalid Google location mapping. Please reconnect your business profile.',
      errorCode: 'INVALID_MAPPING',
    }
  }

  // 2 & 3. Obtain valid token and fetch reviews from Google Business Profile API
  let reviewsResult
  try {
    reviewsResult = await fetchReviewsWithTokenRetry(
      supabase,
      workspaceId,
      activeLoc.google_account_id,
      activeLoc.google_location_id
    )
  } catch (tokenErr: unknown) {
    const errorMsg = sanitizeGoogleDiagnosticError(
      tokenErr instanceof Error ? tokenErr.message : 'Google authentication failure'
    )
    const errorCode = tokenErr instanceof GoogleApiError ? tokenErr.status : 'SERVER_ERROR'
    return {
      success: false,
      workspaceId,
      locationId: activeLoc.id,
      locationName: activeLoc.name,
      totalFetched: 0,
      newReviewsCount: 0,
      updatedReviewsCount: 0,
      unansweredCount: 0,
      negativeReviewsCount: 0,
      skippedReviewsCount: 0,
      failedReviewsCount: 0,
      lastSyncedAt: nowIso,
      message: errorMsg,
      error: errorMsg,
      errorCode,
    }
  }

  if (!reviewsResult.supported) {
    const safeMsg = sanitizeGoogleDiagnosticError(
      reviewsResult.message || 'Google Business Profile Reviews API error.'
    )
    return {
      success: false,
      workspaceId,
      locationId: activeLoc.id,
      locationName: activeLoc.name,
      totalFetched: 0,
      newReviewsCount: 0,
      updatedReviewsCount: 0,
      unansweredCount: 0,
      negativeReviewsCount: 0,
      skippedReviewsCount: 0,
      failedReviewsCount: 0,
      lastSyncedAt: nowIso,
      message: safeMsg,
      error: safeMsg,
      errorCode: reviewsResult.errorCode || 'UNKNOWN',
    }
  }

  let newReviewsCount = 0
  let updatedReviewsCount = 0
  let unansweredCount = 0
  let negativeReviewsCount = 0
  let skippedReviewsCount = 0
  let failedReviewsCount = 0

  // 4. Process and persist each synchronized Google review canonically
  for (const rev of reviewsResult.reviews) {
    if (rev.rating <= 3) {
      negativeReviewsCount++
    }

    const persistRes = await persistCanonicalGoogleReview(supabase, {
      workspaceId,
      locationId: activeLoc.id,
      review: rev,
      nowIso,
      dryRun,
    })

    if (persistRes.effectiveStatus === 'unanswered') {
      unansweredCount++
    }

    if (persistRes.action === 'inserted') newReviewsCount++
    else if (persistRes.action === 'updated') updatedReviewsCount++
    else if (persistRes.action === 'skipped') skippedReviewsCount++
    else failedReviewsCount++

    // Auto-reply processing ONLY when explicitly opted in (skipAutoReply === false)
    if (
      persistRes.reviewDbId &&
      persistRes.effectiveStatus === 'unanswered' &&
      !persistRes.hasExternalReply &&
      !dryRun &&
      !skipAutoReply
    ) {
      try {
        await autoProcessSingleReview(supabase, {
          reviewId: persistRes.reviewDbId,
          workspaceId,
          userId,
        })
      } catch (autoErr) {
        console.warn(`Automated reply trigger for review ${persistRes.reviewDbId} completed with notice:`, autoErr)
      }
    }
  }

  // 5. Update last synchronization timestamp on location and integration records
  if (!dryRun) {
    await supabase
      .from('locations')
      .update({ updated_at: nowIso })
      .eq('id', activeLoc.id)
      .eq('workspace_id', workspaceId)

    await supabase
      .from('google_integrations')
      .update({ updated_at: nowIso })
      .eq('workspace_id', workspaceId)
  }

  return {
    success: true,
    workspaceId,
    locationId: activeLoc.id,
    locationName: activeLoc.name,
    totalFetched: reviewsResult.reviews.length,
    newReviewsCount,
    updatedReviewsCount,
    unansweredCount,
    negativeReviewsCount,
    skippedReviewsCount,
    failedReviewsCount,
    lastSyncedAt: nowIso,
    message: `Synchronized ${reviewsResult.reviews.length} reviews (${newReviewsCount} new, ${updatedReviewsCount} updated) for "${activeLoc.name}".`,
  }
}

/**
 * Queue-Safe Periodic Fallback Review Sync for a single workspace.
 *
 * Security & Queue Invariants:
 * 1. Strict multi-tenant isolation: reads only this workspace's connected location and OAuth tokens.
 * 2. Bounded lookback window (default 24h) and bounded pagination (default max 3 pages x 50 reviews).
 * 3. Canonical idempotent persistence using (workspace_id, external_review_id).
 * 4. NEVER deletes historical reviews when Google no longer returns them.
 * 5. NEVER generates or publishes AI replies directly.
 * 6. For newly discovered (or edited) recent unanswered reviews (within lookback window, no external reply,
 *    and skipAutoReply=false), enqueues into the existing delayed queue (`review_reply_jobs`) via
 *    `enqueueScheduledReplyJob` (`SYNC_RECONCILIATION`) preserving the 5-minute delay, atomic duplicate
 *    protection, and worker-side policy + sensitive-content approval gates.
 * 7. Emits structured JSON metrics and updates google_connection_health.metadata.fallbackReviewSync.
 */
export async function syncWorkspaceGoogleReviewsFallback(
  supabase: TypedSupabaseClient,
  workspaceId: string,
  options: FallbackReviewSyncOptions = {}
): Promise<WorkspaceFallbackSyncMetrics> {
  const nowMs = options.nowMs ?? Date.now()
  const nowIso = new Date(nowMs).toISOString()
  const dryRun = Boolean(options.dryRun)
  const skipAutoReply = Boolean(options.skipAutoReply)
  const lookbackHours = Math.max(1, Math.min(168, Math.floor(options.lookbackHours ?? 24)))
  const maxPages = Math.max(1, Math.min(10, Math.floor(options.maxPages ?? 3)))
  const pageSize = Math.max(1, Math.min(50, Math.floor(options.pageSize ?? 50)))
  const lookbackCutoffMs = nowMs - lookbackHours * 3600_000
  const lookbackCutoffIso = new Date(lookbackCutoffMs).toISOString()

  const baseMetrics = (
    overrides: Partial<WorkspaceFallbackSyncMetrics>
  ): WorkspaceFallbackSyncMetrics => ({
    success: false,
    workspaceId,
    fetched: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    enqueued: 0,
    deduplicatedJobs: 0,
    failed: 0,
    pagesFetched: 0,
    truncatedByLookback: false,
    truncatedByMaxPages: false,
    lookbackCutoffIso,
    syncedAt: nowIso,
    ...overrides,
  })

  if (!workspaceId) {
    return baseMetrics({
      error: 'Workspace ID is required.',
      errorCode: 'INVALID_WORKSPACE',
    })
  }

  // 1. Strictly scope to this workspace's single connected location
  const { data: connectedLocations, error: locError } = await supabase
    .from('locations')
    .select('id, name, google_location_id, google_account_id, is_connected, updated_at')
    .eq('workspace_id', workspaceId)
    .eq('is_connected', true)

  if (locError) {
    const safeErr = sanitizeGoogleDiagnosticError(locError.message)
    if (!dryRun) {
      await recordFallbackSyncHealthMetadata(
        supabase,
        workspaceId,
        {
          lastRunAt: nowIso,
          succeeded: false,
          status: 'failed',
          fetched: 0,
          inserted: 0,
          updated: 0,
          skipped: 0,
          enqueued: 0,
          deduplicatedJobs: 0,
          failed: 1,
          pagesFetched: 0,
          errorCode: 'DB_ERROR',
          errorMessage: safeErr,
        },
        nowIso
      )
    }
    return baseMetrics({ error: safeErr, errorCode: 'DB_ERROR' })
  }

  if (!connectedLocations || connectedLocations.length === 0) {
    return baseMetrics({
      success: true,
      errorCode: 'NOT_CONNECTED',
    })
  }

  if (connectedLocations.length > 1) {
    const safeErr = 'Ambiguous profile selection: multiple active profiles connected.'
    if (!dryRun) {
      await recordFallbackSyncHealthMetadata(
        supabase,
        workspaceId,
        {
          lastRunAt: nowIso,
          succeeded: false,
          status: 'failed',
          fetched: 0,
          inserted: 0,
          updated: 0,
          skipped: 0,
          enqueued: 0,
          deduplicatedJobs: 0,
          failed: 0,
          pagesFetched: 0,
          errorCode: 'AMBIGUOUS_PROFILE',
          errorMessage: safeErr,
        },
        nowIso
      )
    }
    return baseMetrics({ error: safeErr, errorCode: 'AMBIGUOUS_PROFILE' })
  }

  const activeLoc = connectedLocations[0]
  if (!activeLoc.google_location_id || !activeLoc.google_account_id) {
    const safeErr = 'Connected location is missing Google account or location identifier.'
    if (!dryRun) {
      await recordFallbackSyncHealthMetadata(
        supabase,
        workspaceId,
        {
          lastRunAt: nowIso,
          succeeded: false,
          status: 'failed',
          fetched: 0,
          inserted: 0,
          updated: 0,
          skipped: 0,
          enqueued: 0,
          deduplicatedJobs: 0,
          failed: 0,
          pagesFetched: 0,
          errorCode: 'INVALID_MAPPING',
          errorMessage: safeErr,
        },
        nowIso
      )
    }
    return baseMetrics({
      locationId: activeLoc.id,
      locationName: activeLoc.name,
      error: safeErr,
      errorCode: 'INVALID_MAPPING',
    })
  }

  // 2. Fetch recent reviews from Google API with bounded lookback + bounded pagination
  let reviewsResult
  try {
    reviewsResult = await fetchReviewsWithTokenRetry(
      supabase,
      workspaceId,
      activeLoc.google_account_id,
      activeLoc.google_location_id,
      {
        maxPages,
        pageSize,
        stopBeforeIso: lookbackCutoffIso,
        filterToLookback: true,
      }
    )
  } catch (tokenErr: unknown) {
    const safeErr = sanitizeGoogleDiagnosticError(
      tokenErr instanceof Error ? tokenErr.message : 'Google authentication failure'
    )
    const errorCode =
      tokenErr instanceof GoogleApiError && tokenErr.status ? tokenErr.status : 'TOKEN_ERROR'

    if (!dryRun) {
      await recordFallbackSyncHealthMetadata(
        supabase,
        workspaceId,
        {
          lastRunAt: nowIso,
          succeeded: false,
          status: 'failed',
          fetched: 0,
          inserted: 0,
          updated: 0,
          skipped: 0,
          enqueued: 0,
          deduplicatedJobs: 0,
          failed: 0,
          pagesFetched: 0,
          errorCode,
          errorMessage: safeErr,
        },
        nowIso
      )
    }

    console.warn(
      '[google-review-fallback-sync]',
      JSON.stringify({
        workspaceId,
        locationId: activeLoc.id,
        status: 'failed',
        errorCode,
        error: safeErr,
      })
    )

    return baseMetrics({
      locationId: activeLoc.id,
      locationName: activeLoc.name,
      error: safeErr,
      errorCode,
    })
  }

  if (!reviewsResult.supported) {
    const safeErr = sanitizeGoogleDiagnosticError(
      reviewsResult.message || 'Google Business Profile Reviews API error.'
    )
    const errorCode = reviewsResult.errorCode || 'API_ERROR'
    const pagesFetched = reviewsResult.pagesFetched ?? 0

    if (!dryRun) {
      await recordFallbackSyncHealthMetadata(
        supabase,
        workspaceId,
        {
          lastRunAt: nowIso,
          succeeded: false,
          status: 'failed',
          fetched: 0,
          inserted: 0,
          updated: 0,
          skipped: 0,
          enqueued: 0,
          deduplicatedJobs: 0,
          failed: 0,
          pagesFetched,
          errorCode,
          errorMessage: safeErr,
        },
        nowIso
      )
    }

    console.warn(
      '[google-review-fallback-sync]',
      JSON.stringify({
        workspaceId,
        locationId: activeLoc.id,
        status: 'failed',
        errorCode,
        pagesFetched,
        error: safeErr,
      })
    )

    return baseMetrics({
      locationId: activeLoc.id,
      locationName: activeLoc.name,
      pagesFetched,
      error: safeErr,
      errorCode,
    })
  }

  // 3. Persist fetched reviews canonically and enqueue ONLY newly discovered/edited recent unanswered reviews
  const normalizedAccount = activeLoc.google_account_id.startsWith('accounts/')
    ? activeLoc.google_account_id
    : `accounts/${activeLoc.google_account_id}`
  const normalizedLocation = activeLoc.google_location_id.startsWith('locations/')
    ? activeLoc.google_location_id
    : `locations/${activeLoc.google_location_id}`

  let inserted = 0
  let updated = 0
  let skipped = 0
  let enqueued = 0
  let deduplicatedJobs = 0
  let failed = 0

  for (const rev of reviewsResult.reviews) {
    const persistRes = await persistCanonicalGoogleReview(supabase, {
      workspaceId,
      locationId: activeLoc.id,
      review: rev,
      nowIso,
      dryRun,
    })

    if (persistRes.action === 'inserted') inserted++
    else if (persistRes.action === 'updated') updated++
    else if (persistRes.action === 'skipped') skipped++
    else {
      failed++
      continue
    }

    // Queue-safe reply scheduling (NEVER directly generates or publishes replies!)
    if (
      !dryRun &&
      !skipAutoReply &&
      persistRes.reviewDbId &&
      persistRes.effectiveStatus === 'unanswered' &&
      !persistRes.hasExternalReply
    ) {
      const isActionEligible =
        persistRes.action === 'inserted' || (persistRes.action === 'updated' && persistRes.hasEdited)
      const reviewTsMs = Date.parse(rev.updateTime || rev.createTime || rev.reviewDate)
      const isWithinLookback = Number.isFinite(reviewTsMs) && reviewTsMs >= lookbackCutoffMs

      if (isActionEligible && isWithinLookback) {
        // Extra safety check: never enqueue if any reply (published or draft) already exists
        const existingReply = await findExistingReviewReply(
          supabase,
          persistRes.reviewDbId,
          workspaceId
        )

        if (!existingReply) {
          const sourceEventId =
            persistRes.action === 'inserted'
              ? `fallback-sync:${workspaceId}:${rev.reviewId}`
              : `fallback-sync-edit:${workspaceId}:${rev.reviewId}:${rev.reviewDate}`

          const enqueueRes = await enqueueScheduledReplyJob(supabase, {
            workspaceId,
            locationId: activeLoc.id,
            reviewId: persistRes.reviewDbId,
            externalReviewId: rev.reviewId,
            sourceEventId,
            sourceEventType: 'SYNC_RECONCILIATION',
            nowMs,
            metadata: {
              trigger: 'periodic_fallback_sync',
              persistAction: persistRes.action,
              rating: rev.rating,
              lookbackHours,
            },
          })

          if (!enqueueRes.success) {
            failed++
          } else if (enqueueRes.enqueued) {
            enqueued++
          } else if (enqueueRes.deduplicated) {
            deduplicatedJobs++
          }

          // Non-blocking audit record in review_automation_events
          try {
            await supabase.from('review_automation_events').upsert(
              {
                event_id: sourceEventId,
                review_resource_id: `${normalizedAccount}/${normalizedLocation}/reviews/${rev.reviewId}`,
                workspace_id: workspaceId,
                location_id: activeLoc.id,
                review_id: persistRes.reviewDbId,
                event_type: 'SYNC_RECONCILIATION',
                processing_status: enqueueRes.enqueued
                  ? 'scheduled'
                  : enqueueRes.success
                    ? 'skipped'
                    : 'failed',
                publishing_status: enqueueRes.enqueued
                  ? 'pending'
                  : enqueueRes.success
                    ? 'skipped'
                    : 'failed',
                error_message: enqueueRes.error || null,
                metadata: {
                  trigger: 'periodic_fallback_sync',
                  jobId: enqueueRes.jobId,
                  scheduledFor: enqueueRes.scheduledFor,
                  delayMinutes: enqueueRes.delayMinutes,
                  deduplicated: enqueueRes.deduplicated,
                  reason: enqueueRes.reason,
                } as Json,
                updated_at: nowIso,
              },
              { onConflict: 'event_id' }
            )
          } catch (auditErr) {
            console.warn('Non-blocking failure recording fallback sync audit event:', auditErr)
          }
        }
      }
    }
  }

  const metrics: WorkspaceFallbackSyncMetrics = {
    success: failed === 0,
    workspaceId,
    locationId: activeLoc.id,
    locationName: activeLoc.name,
    fetched: reviewsResult.reviews.length,
    inserted,
    updated,
    skipped,
    enqueued,
    deduplicatedJobs,
    failed,
    pagesFetched: reviewsResult.pagesFetched ?? 1,
    truncatedByLookback: Boolean(reviewsResult.truncatedByLookback),
    truncatedByMaxPages: Boolean(reviewsResult.truncatedByMaxPages),
    lookbackCutoffIso,
    syncedAt: nowIso,
  }

  // 4. Update sync timestamps & health metadata
  if (!dryRun) {
    await supabase
      .from('locations')
      .update({ updated_at: nowIso })
      .eq('id', activeLoc.id)
      .eq('workspace_id', workspaceId)

    await supabase
      .from('google_integrations')
      .update({ updated_at: nowIso })
      .eq('workspace_id', workspaceId)

    await recordFallbackSyncHealthMetadata(
      supabase,
      workspaceId,
      {
        lastRunAt: nowIso,
        succeeded: metrics.success,
        status: metrics.success ? 'succeeded' : 'failed',
        fetched: metrics.fetched,
        inserted: metrics.inserted,
        updated: metrics.updated,
        skipped: metrics.skipped,
        enqueued: metrics.enqueued,
        deduplicatedJobs: metrics.deduplicatedJobs,
        failed: metrics.failed,
        pagesFetched: metrics.pagesFetched,
        errorCode: metrics.success ? null : 'PARTIAL_FAILURE',
        errorMessage: metrics.success
          ? null
          : `${metrics.failed} review operation(s) failed during fallback sync.`,
      },
      nowIso
    )
  }

  console.info(
    '[google-review-fallback-sync]',
    JSON.stringify({
      workspaceId,
      locationId: activeLoc.id,
      status: metrics.success ? 'succeeded' : 'partial_failure',
      fetched: metrics.fetched,
      inserted: metrics.inserted,
      updated: metrics.updated,
      skipped: metrics.skipped,
      enqueued: metrics.enqueued,
      deduplicatedJobs: metrics.deduplicatedJobs,
      failed: metrics.failed,
      pagesFetched: metrics.pagesFetched,
      truncatedByLookback: metrics.truncatedByLookback,
      truncatedByMaxPages: metrics.truncatedByMaxPages,
      skipAutoReply,
      dryRun,
    })
  )

  return metrics
}

/**
 * Multi-tenant throttled periodic fallback sync across active connected workspaces.
 *
 * Designed to run inside the existing 1-minute scheduled reply worker (`runScheduledReplyWorker`)
 * with per-workspace throttling (default every 10 minutes), bounded lookback (24h),
 * bounded per-tick workspace budget, and strict tenant + fault isolation.
 */
export async function runPeriodicGoogleReviewFallbackSync(
  supabase: TypedSupabaseClient,
  options: PeriodicFallbackSyncOptions = {}
): Promise<PeriodicFallbackSyncSummary> {
  const nowMs = options.nowMs ?? Date.now()
  const ranAt = new Date(nowMs).toISOString()
  const intervalMinutes = Math.max(1, Math.min(1440, Math.floor(options.intervalMinutes ?? 10)))
  const intervalMs = intervalMinutes * 60_000
  const maxWorkspacesPerTick = Math.max(1, Math.min(50, Math.floor(options.maxWorkspacesPerTick ?? 10)))
  const lookbackHours = options.lookbackHours ?? 24
  const maxPagesPerWorkspace = options.maxPagesPerWorkspace ?? 3
  const pageSize = options.pageSize ?? 50
  const dryRun = Boolean(options.dryRun)
  const skipAutoReply = Boolean(options.skipAutoReply)
  const force = Boolean(options.force)

  const summary: PeriodicFallbackSyncSummary = {
    success: true,
    workspacesScanned: 0,
    workspacesEligible: 0,
    workspacesSynced: 0,
    workspacesThrottled: 0,
    workspacesFailed: 0,
    fetched: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    enqueued: 0,
    deduplicatedJobs: 0,
    failed: 0,
    errors: [],
    results: [],
    ranAt,
  }

  // 1. Identify candidate workspaces that have an active connected location AND a Google integration
  let candidateWorkspaceIds: string[] = []
  if (options.workspaceIds && options.workspaceIds.length > 0) {
    candidateWorkspaceIds = Array.from(new Set(options.workspaceIds.filter(Boolean)))
  } else {
    const { data: connectedLocs, error: locErr } = await supabase
      .from('locations')
      .select('workspace_id')
      .eq('is_connected', true)

    if (locErr) {
      summary.success = false
      summary.errors.push({
        workspaceId: 'query',
        error: sanitizeGoogleDiagnosticError(locErr.message),
        errorCode: 'DB_ERROR',
      })
      return summary
    }

    const connectedWsIds = Array.from(
      new Set((connectedLocs || []).map((l) => l.workspace_id).filter(Boolean))
    )

    if (connectedWsIds.length === 0) {
      return summary
    }

    const { data: integrations, error: integErr } = await supabase
      .from('google_integrations')
      .select('workspace_id')
      .in('workspace_id', connectedWsIds)

    if (integErr) {
      summary.success = false
      summary.errors.push({
        workspaceId: 'query',
        error: sanitizeGoogleDiagnosticError(integErr.message),
        errorCode: 'DB_ERROR',
      })
      return summary
    }

    candidateWorkspaceIds = Array.from(
      new Set((integrations || []).map((i) => i.workspace_id).filter(Boolean))
    )
  }

  summary.workspacesScanned = candidateWorkspaceIds.length
  if (candidateWorkspaceIds.length === 0) {
    return summary
  }

  // 2. Check per-workspace throttle state from google_connection_health.metadata
  const { data: healthRows } = await supabase
    .from('google_connection_health')
    .select('workspace_id, metadata')
    .in('workspace_id', candidateWorkspaceIds)

  const lastRunMap = new Map<string, number>()
  for (const row of healthRows || []) {
    const lastRunIso = extractLastFallbackSyncRunAt(row.metadata)
    if (lastRunIso) {
      lastRunMap.set(row.workspace_id, Date.parse(lastRunIso))
    }
  }

  const dueWorkspaces: Array<{ workspaceId: string; lastRunMs: number }> = []
  for (const wsId of candidateWorkspaceIds) {
    const lastRunMs = lastRunMap.get(wsId) ?? 0
    if (!force && lastRunMs > 0 && nowMs - lastRunMs < intervalMs) {
      summary.workspacesThrottled++
      continue
    }
    dueWorkspaces.push({ workspaceId: wsId, lastRunMs })
  }

  // Fair round-robin: oldest-synced (or never-synced) workspaces run first
  dueWorkspaces.sort((a, b) => a.lastRunMs - b.lastRunMs)
  summary.workspacesEligible = dueWorkspaces.length
  const batch = dueWorkspaces.slice(0, maxWorkspacesPerTick)

  // 3. Execute per-workspace fallback sync with strict tenant + fault isolation
  for (const item of batch) {
    try {
      const wsResult = await syncWorkspaceGoogleReviewsFallback(supabase, item.workspaceId, {
        dryRun,
        skipAutoReply,
        lookbackHours,
        maxPages: maxPagesPerWorkspace,
        pageSize,
        nowMs,
      })

      summary.results.push(wsResult)
      summary.fetched += wsResult.fetched
      summary.inserted += wsResult.inserted
      summary.updated += wsResult.updated
      summary.skipped += wsResult.skipped
      summary.enqueued += wsResult.enqueued
      summary.deduplicatedJobs += wsResult.deduplicatedJobs
      summary.failed += wsResult.failed

      if (wsResult.success) {
        summary.workspacesSynced++
      } else {
        summary.workspacesFailed++
        summary.errors.push({
          workspaceId: item.workspaceId,
          error: wsResult.error || 'Fallback review sync failed.',
          errorCode: wsResult.errorCode,
        })
      }
    } catch (err: unknown) {
      const safeErr = sanitizeGoogleDiagnosticError(
        err instanceof Error ? err.message : 'Unexpected fallback review sync error.'
      )
      summary.workspacesFailed++
      summary.failed++
      summary.errors.push({
        workspaceId: item.workspaceId,
        error: safeErr,
        errorCode: 'UNEXPECTED_ERROR',
      })
    }
  }

  summary.success = summary.workspacesFailed === 0 && summary.errors.length === 0
  return summary
}

/**
 * Scans and synchronizes Google reviews across all active connected workspaces.
 * Defaults to `skipAutoReply = true` to prevent accidental inline auto-replies outside the delayed queue.
 */
export async function syncAllActiveWorkspacesGoogleReviews(
  supabase: TypedSupabaseClient,
  options: { workspaceId?: string; dryRun?: boolean; userId?: string | null; skipAutoReply?: boolean } = {}
): Promise<BatchSyncReviewsResult> {
  const { workspaceId, dryRun = false, userId = null, skipAutoReply = true } = options
  const nowIso = new Date().toISOString()

  let targetWorkspaceIds: string[] = []

  if (workspaceId) {
    targetWorkspaceIds = [workspaceId]
  } else {
    const { data: activeLocs, error: queryError } = await supabase
      .from('locations')
      .select('workspace_id')
      .eq('is_connected', true)

    if (queryError || !activeLocs) {
      return {
        success: false,
        workspacesScanned: 0,
        workspacesSynced: 0,
        totalFetched: 0,
        newReviewsCount: 0,
        updatedReviewsCount: 0,
        unansweredCount: 0,
        negativeReviewsCount: 0,
        errors: [{ workspaceId: 'query', error: queryError?.message || 'Database error' }],
        lastSyncedAt: nowIso,
      }
    }

    targetWorkspaceIds = Array.from(new Set(activeLocs.map((l) => l.workspace_id)))
  }

  let workspacesSynced = 0
  let totalFetched = 0
  let totalNew = 0
  let totalUpdated = 0
  let totalUnanswered = 0
  let totalNegative = 0
  const errors: Array<{ workspaceId: string; error: string }> = []

  for (const wsId of targetWorkspaceIds) {
    try {
      const res = await syncWorkspaceGoogleReviews(supabase, wsId, { dryRun, userId, skipAutoReply })
      if (res.success) {
        workspacesSynced++
        totalFetched += res.totalFetched
        totalNew += res.newReviewsCount
        totalUpdated += res.updatedReviewsCount
        totalUnanswered += res.unansweredCount
        totalNegative += res.negativeReviewsCount
      } else if (res.error) {
        errors.push({ workspaceId: wsId, error: res.error })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown sync error'
      errors.push({ workspaceId: wsId, error: msg })
    }
  }

  return {
    success: errors.length === 0,
    workspacesScanned: targetWorkspaceIds.length,
    workspacesSynced,
    totalFetched,
    newReviewsCount: totalNew,
    updatedReviewsCount: totalUpdated,
    unansweredCount: totalUnanswered,
    negativeReviewsCount: totalNegative,
    errors,
    lastSyncedAt: nowIso,
  }
}
