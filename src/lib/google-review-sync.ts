import { TypedSupabaseClient } from './reply-safety'
import {
  getValidGoogleAccessToken,
  fetchGoogleReviews,
} from './google-business'
import { autoProcessSingleReview } from './reply-automation'

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
  lastSyncedAt: string
  message: string
  error?: string
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

/**
 * Synchronizes Google Business Profile reviews for a specific workspace's single active connected profile.
 *
 * Behaviors:
 * 1. Strictly enforces the single connected profile policy (fails closed if 0 or >1 profiles active).
 * 2. Automatically decrypts and refreshes Google OAuth tokens if expiring or expired.
 * 3. Fetches live reviews from the Google Business Profile API.
 * 4. Idempotently upserts reviews: detects newly posted reviews and edited reviews.
 * 5. Preserves existing review replies and reply history.
 * 6. Immediately triggers automated AI reply processing for newly discovered unanswered reviews (unless skipAutoReply is set).
 * 7. Updates synchronization timestamps on locations and google_integrations.
 */
export async function syncWorkspaceGoogleReviews(
  supabase: TypedSupabaseClient,
  workspaceId: string,
  options: SyncOptions = {}
): Promise<SyncWorkspaceReviewsResult> {
  const { dryRun = false, userId = null, skipAutoReply = false } = options
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
      lastSyncedAt: nowIso,
      message: 'Synchronization skipped: No business profile is connected for this workspace.',
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
      lastSyncedAt: nowIso,
      message: 'Automation stopped: Ambiguous profile selection (multiple profiles active). Exactly one profile must be selected.',
      error: 'Ambiguous profile selection. Exactly one profile must be selected.',
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
      lastSyncedAt: nowIso,
      message: 'Connected business profile is missing Google Location or Account ID mapping.',
      error: 'Invalid Google location mapping. Please reconnect your business profile.',
    }
  }

  // 2. Obtain a valid, auto-refreshed Google access token
  let accessToken: string
  try {
    const tokenResult = await getValidGoogleAccessToken(supabase, workspaceId)
    accessToken = tokenResult.accessToken
  } catch (tokenErr: unknown) {
    const errorMsg = tokenErr instanceof Error ? tokenErr.message : 'Google authentication failure'
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
      lastSyncedAt: nowIso,
      message: errorMsg,
      error: errorMsg,
    }
  }

  // 3. Fetch reviews from Google Business Profile API
  const reviewsResult = await fetchGoogleReviews(
    accessToken,
    activeLoc.google_account_id,
    activeLoc.google_location_id
  )

  if (!reviewsResult.supported) {
    // Report Google API permissions/connectivity failures instead of masking as success
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
      lastSyncedAt: nowIso,
      message: reviewsResult.message || 'Google Business Profile Reviews API access pending or unavailable.',
      error: reviewsResult.message || 'Google Business Profile Reviews API error.',
    }
  }

  let newReviewsCount = 0
  let updatedReviewsCount = 0
  let unansweredCount = 0
  let negativeReviewsCount = 0
  let skippedReviewsCount = 0

  // 4. Process and upsert each synchronized Google review
  for (const rev of reviewsResult.reviews) {
    if (rev.rating <= 3) {
      negativeReviewsCount++
    }

    const sentiment: 'positive' | 'neutral' | 'negative' =
      rev.rating >= 4 ? 'positive' : rev.rating === 3 ? 'neutral' : 'negative'
    const status: 'unanswered' | 'answered' = rev.reply ? 'answered' : 'unanswered'

    if (status === 'unanswered') {
      unansweredCount++
    }

    // Check if review already exists in Supabase
    const { data: existingReview } = await supabase
      .from('reviews')
      .select('id, rating, content, review_date, status, location_id')
      .eq('workspace_id', workspaceId)
      .eq('external_review_id', rev.reviewId)
      .maybeSingle()

    let reviewDbId: string | null = null

    if (existingReview?.id) {
      reviewDbId = existingReview.id

      // Detect if customer edited the review
      const existingDateMs = existingReview.review_date ? new Date(existingReview.review_date).getTime() : 0
      const revDateMs = rev.reviewDate ? new Date(rev.reviewDate).getTime() : 0
      const hasEdited =
        existingReview.rating !== rev.rating ||
        existingReview.content !== rev.content ||
        Math.abs(existingDateMs - revDateMs) > 1000

      if (hasEdited) {
        if (!dryRun) {
          await supabase
            .from('reviews')
            .update({
              rating: rev.rating,
              content: rev.content,
              author_name: rev.authorName,
              author_photo_url: rev.authorPhotoUrl,
              review_date: rev.reviewDate,
              sentiment,
              status: rev.reply?.comment ? 'answered' : existingReview.status,
              updated_at: nowIso,
            })
            .eq('id', existingReview.id)
        }
        updatedReviewsCount++
      } else {
        skippedReviewsCount++
      }
    } else {
      // New review detected
      if (!dryRun) {
        const { data: insertedRev, error: insertError } = await supabase
          .from('reviews')
          .insert({
            workspace_id: workspaceId,
            location_id: activeLoc.id,
            author_name: rev.authorName,
            author_photo_url: rev.authorPhotoUrl,
            rating: rev.rating,
            content: rev.content,
            review_date: rev.reviewDate,
            source: 'google',
            status,
            sentiment,
            external_review_id: rev.reviewId,
          })
          .select('id')
          .single()

        if (!insertError && insertedRev) {
          reviewDbId = insertedRev.id
        }
      }
      newReviewsCount++
    }

    // Synchronize Google-provided reply if present
    if (reviewDbId && rev.reply?.comment && !dryRun) {
      const { data: existingReply } = await supabase
        .from('review_replies')
        .select('id, content')
        .eq('review_id', reviewDbId)
        .maybeSingle()

      if (existingReply?.id) {
        if (existingReply.content !== rev.reply.comment) {
          await supabase
            .from('review_replies')
            .update({
              content: rev.reply.comment,
              updated_at: nowIso,
            })
            .eq('id', existingReply.id)
        }
      } else {
        await supabase.from('review_replies').insert({
          review_id: reviewDbId,
          workspace_id: workspaceId,
          content: rev.reply.comment,
          is_ai_generated: false,
          status: 'published',
        })
      }
    }

    // Auto-reply processing for newly discovered unanswered reviews (unless skipAutoReply is set)
    if (reviewDbId && status === 'unanswered' && !dryRun && !skipAutoReply) {
      try {
        await autoProcessSingleReview(supabase, {
          reviewId: reviewDbId,
          workspaceId,
          userId,
        })
      } catch (autoErr) {
        console.warn(`Automated reply trigger for review ${reviewDbId} completed with notice:`, autoErr)
      }
    }
  }

  // 5. Update last synchronization timestamp on location and integration records
  if (!dryRun) {
    await supabase
      .from('locations')
      .update({ updated_at: nowIso })
      .eq('id', activeLoc.id)

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
    lastSyncedAt: nowIso,
    message: `Synchronized ${reviewsResult.reviews.length} reviews (${newReviewsCount} new, ${updatedReviewsCount} updated) for "${activeLoc.name}".`,
  }
}

/**
 * Scans and synchronizes Google reviews across all active connected workspaces.
 * Called automatically by scheduled background cron, worker scripts, and automation webhooks.
 */
export async function syncAllActiveWorkspacesGoogleReviews(
  supabase: TypedSupabaseClient,
  options: { workspaceId?: string; dryRun?: boolean; userId?: string | null; skipAutoReply?: boolean } = {}
): Promise<BatchSyncReviewsResult> {
  const { workspaceId, dryRun = false, userId = null, skipAutoReply = false } = options
  const nowIso = new Date().toISOString()

  let targetWorkspaceIds: string[] = []

  if (workspaceId) {
    targetWorkspaceIds = [workspaceId]
  } else {
    // Find all distinct workspaces that have an active connected location
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
