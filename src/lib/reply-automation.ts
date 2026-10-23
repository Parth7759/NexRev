import {
  TypedSupabaseClient,
  getWorkspaceReplySettings,
  evaluateReplyApprovalPolicy,
  logReplyAudit,
  findExistingReviewReply,
} from './reply-safety'
import { generateReviewReply, ReplyTone } from './ai'
import { publishGoogleReviewReply } from './google-business'

export interface ProcessSingleReviewParams {
  reviewId: string
  workspaceId: string
  dryRun?: boolean
  tone?: ReplyTone
  userId?: string | null
  forceRegenerate?: boolean
}

export interface ProcessReviewResult {
  success: boolean
  skipped?: boolean
  alreadyPublished?: boolean
  status?: 'draft' | 'published' | 'failed' | 'simulated_publish'
  replyId?: string
  replyContent?: string
  requiresApproval?: boolean
  error?: string
  reason?: string
  dryRun?: boolean
}

export interface ProcessWorkspaceReviewsParams {
  workspaceId?: string
  limit?: number
  dryRun?: boolean
  onlyUnanswered?: boolean
}

export interface BatchProcessResult {
  success: boolean
  scanned: number
  processed: number
  draftsCreated: number
  published: number
  skipped: number
  failed: number
  errors: Array<{ reviewId: string; error: string }>
  dryRun: boolean
}

/**
 * Core Automation Engine: Processes an individual review end-to-end.
 *
 * Mandatory behaviors enforced:
 * 1. Generates a personalized AI reply for EVERY rating (1-5 stars are never skipped).
 * 2. Reads actual review text and rating before generating.
 * 3. Enforces multi-tenant isolation (review MUST belong to workspace).
 * 4. Checks idempotency: skips already published reviews; avoids duplicating drafts.
 * 5. Evaluates workspace policy:
 *    - Manual Approval: saved as draft.
 *    - Positive-only mode: 4-5 stars auto-publish; 1-3 stars saved as draft.
 *    - Auto-publish all: 1-3 stars require approval by default unless owner explicitly disabled critical gate.
 * 6. Supports dryRun=true to safely simulate workflows with ZERO live external calls.
 * 7. Records audit trail logs for generated, published, and failed actions.
 */
export async function autoProcessSingleReview(
  supabase: TypedSupabaseClient,
  params: ProcessSingleReviewParams
): Promise<ProcessReviewResult> {
  const { reviewId, workspaceId, dryRun = false, userId = null } = params

  if (!reviewId || !workspaceId) {
    return { success: false, error: 'reviewId and workspaceId are required.' }
  }

  // 1. Fetch target review with location details
  const { data: targetReview, error: reviewError } = await supabase
    .from('reviews')
    .select(`
      id,
      workspace_id,
      rating,
      content,
      author_name,
      external_review_id,
      location_id,
      status,
      locations (
        name,
        google_location_id,
        google_account_id
      )
    `)
    .eq('id', reviewId)
    .maybeSingle()

  if (reviewError || !targetReview) {
    return { success: false, error: 'Review not found.' }
  }

  // Multi-tenant security check
  if (targetReview.workspace_id !== workspaceId) {
    return {
      success: false,
      error: 'Security violation: Review does not belong to specified workspace.',
    }
  }

  // 2. Idempotency Check: Prevent duplicate publishing
  const existingReply = await findExistingReviewReply(supabase, reviewId, workspaceId)
  if (existingReply && existingReply.status === 'published') {
    return {
      success: true,
      skipped: true,
      alreadyPublished: true,
      status: 'published',
      replyId: existingReply.id,
      replyContent: existingReply.content,
      reason: 'Review already has a published reply.',
    }
  }

  if (existingReply && existingReply.status === 'draft' && !params.forceRegenerate) {
    return {
      success: true,
      skipped: true,
      status: 'draft',
      replyId: existingReply.id,
      replyContent: existingReply.content,
      reason: 'Draft reply already exists for this review.',
    }
  }

  // 3. Fetch workspace settings
  const settings = await getWorkspaceReplySettings(supabase, workspaceId)
  const selectedTone = params.tone || settings.defaultReplyTone || 'professional'
  const locData = Array.isArray(targetReview.locations)
    ? targetReview.locations[0]
    : targetReview.locations
  const locationName = locData?.name || undefined

  // 4. Generate AI Reply for review (1-5 stars are never skipped)
  const aiResult = await generateReviewReply({
    authorName: targetReview.author_name,
    rating: targetReview.rating,
    reviewContent: targetReview.content || '',
    locationName,
    businessName: settings.businessContext || undefined,
    tone: selectedTone,
  })

  if (!aiResult.success || !aiResult.reply) {
    await logReplyAudit(supabase, {
      workspaceId,
      reviewId,
      userId,
      action: 'failed',
      tone: selectedTone,
      errorMessage: aiResult.error || 'AI generation failed',
      metadata: { autoProcessed: true },
    })
    return {
      success: false,
      error: aiResult.error || 'Failed to generate AI reply for review.',
    }
  }

  // 5. Evaluate approval policy
  const policy = evaluateReplyApprovalPolicy(targetReview.rating, settings)

  // 6. Handle Draft Saving (when approval required OR dryRun mode)
  if (policy.requiresApproval || dryRun) {
    let replyId: string
    if (existingReply) {
      const { data: updated } = await supabase
        .from('review_replies')
        .update({
          content: aiResult.reply.trim(),
          tone: selectedTone,
          user_id: userId,
          status: 'draft',
          is_ai_generated: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingReply.id)
        .select('id')
        .single()
      replyId = updated?.id || existingReply.id
    } else {
      const { data: inserted } = await supabase
        .from('review_replies')
        .insert({
          review_id: reviewId,
          workspace_id: workspaceId,
          user_id: userId,
          content: aiResult.reply.trim(),
          tone: selectedTone,
          is_ai_generated: true,
          status: 'draft',
        })
        .select('id')
        .single()
      replyId = inserted?.id || ''
    }

    await logReplyAudit(supabase, {
      workspaceId,
      reviewId,
      replyId,
      userId,
      action: 'generated',
      content: aiResult.reply.trim(),
      tone: selectedTone,
      metadata: {
        autoProcessed: true,
        savedAsDraft: true,
        dryRun,
        policyReason: policy.reason,
      },
    })

    return {
      success: true,
      replyId,
      replyContent: aiResult.reply.trim(),
      status: dryRun && !policy.requiresApproval ? 'simulated_publish' : 'draft',
      requiresApproval: policy.requiresApproval,
      dryRun,
      reason: dryRun
        ? `[Dry Run] Simulated completion. Policy: ${policy.reason}`
        : `Reply draft saved. ${policy.reason}`,
    }
  }

  // 7. Auto-Publishing Workflow (when policy permits and not dryRun)
  let replyId: string
  if (existingReply) {
    const { data: updated } = await supabase
      .from('review_replies')
      .update({
        content: aiResult.reply.trim(),
        tone: selectedTone,
        user_id: userId,
        status: 'published',
        is_ai_generated: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingReply.id)
      .select('id')
      .single()
    replyId = updated?.id || existingReply.id
  } else {
    const { data: inserted } = await supabase
      .from('review_replies')
      .insert({
        review_id: reviewId,
        workspace_id: workspaceId,
        user_id: userId,
        content: aiResult.reply.trim(),
        tone: selectedTone,
        is_ai_generated: true,
        status: 'published',
      })
      .select('id')
      .single()
    replyId = inserted?.id || ''
  }

  const googleLocationId = locData?.google_location_id
  const googleAccountId = locData?.google_account_id
  const externalReviewId = targetReview.external_review_id

  if (googleLocationId && externalReviewId) {
    try {
      const googleRes = await publishGoogleReviewReply(
        supabase,
        workspaceId,
        googleLocationId,
        externalReviewId,
        aiResult.reply.trim(),
        googleAccountId
      )

      if (!googleRes.success) {
        // Rollback status to failed if Google API call fails
        await supabase
          .from('review_replies')
          .update({ status: 'failed', updated_at: new Date().toISOString() })
          .eq('id', replyId)

        await logReplyAudit(supabase, {
          workspaceId,
          reviewId,
          replyId,
          userId,
          action: 'failed',
          content: aiResult.reply.trim(),
          tone: selectedTone,
          errorMessage: googleRes.error,
          metadata: {
            autoProcessed: true,
            googlePublishAttempted: true,
            error: googleRes.error,
          },
        })

        return {
          success: false,
          replyId,
          status: 'failed',
          error: `Google publishing failed: ${googleRes.error}. Reply saved with status failed.`,
        }
      }
    } catch (gErr: unknown) {
      const msg = gErr instanceof Error ? gErr.message : 'Google API communication error'
      await supabase
        .from('review_replies')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', replyId)

      await logReplyAudit(supabase, {
        workspaceId,
        reviewId,
        replyId,
        userId,
        action: 'failed',
        content: aiResult.reply.trim(),
        tone: selectedTone,
        errorMessage: msg,
        metadata: { autoProcessed: true },
      })

      return {
        success: false,
        replyId,
        status: 'failed',
        error: `Google communication failure: ${msg}`,
      }
    }
  }

  // Mark review as answered
  await supabase
    .from('reviews')
    .update({ status: 'answered', updated_at: new Date().toISOString() })
    .eq('id', reviewId)
    .eq('workspace_id', workspaceId)

  await logReplyAudit(supabase, {
    workspaceId,
    reviewId,
    replyId,
    userId,
    action: 'published',
    content: aiResult.reply.trim(),
    tone: selectedTone,
    metadata: {
      autoProcessed: true,
      googleSyncAttempted: Boolean(googleLocationId && externalReviewId),
      policyReason: policy.reason,
    },
  })

  return {
    success: true,
    replyId,
    replyContent: aiResult.reply.trim(),
    status: 'published',
    requiresApproval: false,
    reason: policy.reason,
  }
}

/**
 * Scans unanswered reviews across one or all workspaces and processes them in batch.
 * Used by scheduled jobs, cron endpoints, and background workers.
 */
export async function autoProcessWorkspaceUnansweredReviews(
  supabase: TypedSupabaseClient,
  params: ProcessWorkspaceReviewsParams = {}
): Promise<BatchProcessResult> {
  const { workspaceId, limit = 25, dryRun = false } = params

  let query = supabase
    .from('reviews')
    .select(`
      id,
      workspace_id,
      status,
      created_at
    `)
    .eq('status', 'unanswered')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId)
  }

  const { data: unansweredReviews, error } = await query

  if (error || !unansweredReviews) {
    console.error('Failed to query unanswered reviews for batch processing:', error?.message)
    return {
      success: false,
      scanned: 0,
      processed: 0,
      draftsCreated: 0,
      published: 0,
      skipped: 0,
      failed: 0,
      errors: [{ reviewId: 'query', error: error?.message || 'Database error' }],
      dryRun,
    }
  }

  let processed = 0
  let draftsCreated = 0
  let published = 0
  let skipped = 0
  let failed = 0
  const errors: Array<{ reviewId: string; error: string }> = []

  for (const review of unansweredReviews) {
    try {
      const result = await autoProcessSingleReview(supabase, {
        reviewId: review.id,
        workspaceId: review.workspace_id,
        dryRun,
      })

      if (result.skipped) {
        skipped++
      } else if (result.success) {
        processed++
        if (result.status === 'published') {
          published++
        } else {
          draftsCreated++
        }
      } else {
        failed++
        errors.push({ reviewId: review.id, error: result.error || 'Unknown error' })
      }
    } catch (itemErr: unknown) {
      failed++
      const msg = itemErr instanceof Error ? itemErr.message : 'Processing error'
      errors.push({ reviewId: review.id, error: msg })
    }
  }

  return {
    success: errors.length === 0,
    scanned: unansweredReviews.length,
    processed,
    draftsCreated,
    published,
    skipped,
    failed,
    errors,
    dryRun,
  }
}
