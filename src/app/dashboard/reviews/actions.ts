'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/utils/supabase/server'
import { generateReviewReply, ReplyTone } from '@/lib/ai'
import { checkRateLimit } from '@/lib/rate-limit'
import { verifyWorkspaceMembership } from '@/lib/workspace'
import {
  getWorkspaceReplySettings,
  logReplyAudit,
  findExistingReviewReply,
  evaluateReplyApprovalPolicy,
  toggleFullyAutomaticReplies,
  isFullyAutomaticModeActive,
} from '@/lib/reply-safety'
import { publishGoogleReviewReply } from '@/lib/google-business'
import { autoProcessSingleReview } from '@/lib/reply-automation'
import {
  evaluateAutomationHealth,
  EvaluatedAutomationHealth,
} from '@/lib/automation-health'

export interface GenerateReplyActionParams {
  authorName?: string
  rating: number
  reviewContent: string
  locationName?: string
  tone: ReplyTone
  workspaceId?: string
  reviewId?: string
}

export interface SaveReplyActionParams {
  reviewId?: string
  workspaceId?: string
  content: string
  tone: ReplyTone
  isAiGenerated: boolean
  isDemo?: boolean
  publishToGoogle?: boolean
  manualApprovalConfirmed?: boolean
}

/**
 * Checks server-side if OPENAI_API_KEY is configured.
 * Safely returns a boolean flag without ever exposing the key.
 */
export async function getAiStatus() {
  const hasKey = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim() !== '')
  return {
    configured: hasKey,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  }
}

/**
 * Server Action: Generates an AI reply for a review.
 * Enforces rate limiting, user authentication, workspace boundary checks,
 * passes business context, and records an audit log entry.
 */
export async function generateAiReplyAction(params: GenerateReplyActionParams) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const isDemo = !params.reviewId || params.reviewId.startsWith('demo-') || !params.workspaceId

  if (!isDemo && !user) {
    return {
      success: false,
      error: 'You must be signed in to generate AI replies for live reviews.',
    }
  }

  // Rate limit: 10 requests per minute per user
  const rateLimitKey = user?.id || 'demo-preview-user'
  const rateLimit = checkRateLimit(rateLimitKey, 10, 60 * 1000)
  if (!rateLimit.success) {
    const seconds = Math.ceil(rateLimit.resetMs / 1000)
    return {
      success: false,
      error: `Rate limit reached. Please wait ${seconds} second${seconds === 1 ? '' : 's'} before requesting another AI reply.`,
    }
  }

  // Retrieve workspace settings for custom business context if workspaceId is provided
  let businessContext = ''
  if (params.workspaceId && user) {
    const membership = await verifyWorkspaceMembership(supabase, params.workspaceId)
    if (!membership.isMember) {
      return {
        success: false,
        error: membership.error || 'Unauthorized: You are not authorized for this workspace.',
      }
    }
    const settings = await getWorkspaceReplySettings(supabase, params.workspaceId)
    businessContext = settings.businessContext

    // For live reviews, enforce strict profile selection isolation
    if (params.reviewId && !params.reviewId.startsWith('demo-')) {
      const { data: rev } = await supabase
        .from('reviews')
        .select('id, workspace_id, location_id')
        .eq('id', params.reviewId)
        .maybeSingle()

      if (rev) {
        if (rev.workspace_id !== params.workspaceId) {
          return { success: false, error: 'Security violation: Review does not belong to specified workspace.' }
        }

        const { data: wsLocs } = await supabase
          .from('locations')
          .select('id')
          .eq('workspace_id', params.workspaceId)
          .eq('is_connected', true)

        if (!wsLocs || wsLocs.length === 0) {
          return {
            success: false,
            error: 'AI generation blocked: No business profile is currently selected for this workspace. Please select a profile first.',
          }
        }

        if (wsLocs.length > 1) {
          return {
            success: false,
            error: 'AI generation blocked: Ambiguous profile selection (multiple profiles active). Please select a single profile.',
          }
        }

        if (rev.location_id !== wsLocs[0].id) {
          return {
            success: false,
            error: 'AI generation blocked: This review belongs to an unselected business profile. Only the selected profile can be processed.',
          }
        }
      }
    }
  }

  // Execute AI generation for ALL ratings (1-5 stars are never blocked)
  const result = await generateReviewReply({
    authorName: params.authorName,
    rating: params.rating,
    reviewContent: params.reviewContent?.trim() || '',
    locationName: params.locationName,
    businessName: params.locationName || businessContext || 'our business',
    businessContext: businessContext || undefined,
    tone: params.tone,
  })

  // Record audit log entry and auto-save draft for live reviews
  if (params.workspaceId && params.reviewId && !params.reviewId.startsWith('demo-')) {
    await logReplyAudit(supabase, {
      workspaceId: params.workspaceId,
      reviewId: params.reviewId,
      userId: user?.id || null,
      action: result.success ? 'generated' : 'failed',
      content: result.reply || null,
      tone: params.tone,
      errorMessage: result.error || null,
    })

    // Rule 6: Generate and save reply draft for all ratings, even when approval is required
    if (result.success && result.reply) {
      try {
        const existingReply = await findExistingReviewReply(supabase, params.reviewId, params.workspaceId)
        if (!existingReply) {
          await supabase.from('review_replies').insert({
            review_id: params.reviewId,
            workspace_id: params.workspaceId,
            user_id: user?.id || null,
            content: result.reply.trim(),
            tone: params.tone,
            status: 'draft',
            is_ai_generated: true,
          })
        } else if (existingReply.status !== 'published') {
          await supabase
            .from('review_replies')
            .update({
              content: result.reply.trim(),
              tone: params.tone,
              user_id: user?.id || null,
              status: 'draft',
              is_ai_generated: true,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingReply.id)
        }
      } catch (err) {
        console.warn('Could not auto-save draft to database:', err)
      }
    }
  }

  return result
}

/**
 * Server Action: Saves an edited or generated review reply to the database.
 * Strictly verifies workspace membership, cross-tenant isolation, prevents duplicate
 * submissions, evaluates auto-reply policies, and publishes to Google if connected.
 */
export async function saveReviewReplyAction(params: SaveReplyActionParams) {
  if (!params.content || params.content.trim() === '') {
    return {
      success: false,
      error: 'Reply content cannot be empty.',
    }
  }

  // Handle Demo Reviews gracefully - demo drafts remain local/in-memory and NEVER touch the database or Google
  if (params.isDemo || !params.reviewId || params.reviewId.startsWith('demo-')) {
    return {
      success: true,
      isDemo: true,
      message: 'Draft updated in demo mode. Demo drafts are kept locally and are never stored or published to Google.',
    }
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return {
      success: false,
      error: 'You must be signed in to save review replies.',
    }
  }

  // Real review flow: workspace membership MUST be strictly verified
  if (!params.workspaceId) {
    return {
      success: false,
      error: 'Workspace ID is required to save a reply to a live review.',
    }
  }

  const membership = await verifyWorkspaceMembership(supabase, params.workspaceId)
  if (!membership.isMember) {
    return {
      success: false,
      error: membership.error || 'Forbidden: You do not have permission to post replies in this workspace.',
    }
  }

  // 1. Multi-Tenant Cross-Workspace Guard: Verify the review actually belongs to this workspace
  const { data: targetReview, error: reviewFetchError } = await supabase
    .from('reviews')
    .select(`
      id,
      workspace_id,
      rating,
      external_review_id,
      location_id,
      locations (
        name,
        google_location_id,
        google_account_id,
        is_connected
      )
    `)
    .eq('id', params.reviewId)
    .maybeSingle()

  if (reviewFetchError || !targetReview) {
    return {
      success: false,
      error: 'The specified review could not be found.',
    }
  }

  if (targetReview.workspace_id !== params.workspaceId) {
    return {
      success: false,
      error: 'Unauthorized: Security violation - review does not belong to this workspace.',
    }
  }

  // 2. Fetch workspace reply settings & evaluate policy
  const settings = await getWorkspaceReplySettings(supabase, params.workspaceId)
  const policy = evaluateReplyApprovalPolicy(targetReview.rating, settings)

  // 3. Prevent duplicate rows: Check if a reply already exists for this review
  const existingReply = await findExistingReviewReply(supabase, params.reviewId, params.workspaceId)

  // 4. Evaluate policy: If caller specified publishToGoogle === false, or if automated / unconfirmed and policy requires approval, save as draft
  const isExplicitDraft = params.publishToGoogle === false
  const requiresManualGate = isExplicitDraft || (policy.requiresApproval && !params.manualApprovalConfirmed)
  const targetInitialStatus = requiresManualGate ? 'draft' : 'published'

  let replyId: string
  let actionTaken: 'published' | 'edited' | 'failed' = 'published'

  if (existingReply) {
    // Update existing reply to prevent duplicate row accumulation
    const { data: updatedReply, error: updateError } = await supabase
      .from('review_replies')
      .update({
        content: params.content.trim(),
        tone: params.tone,
        user_id: user.id,
        status: targetInitialStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingReply.id)
      .select('id')
      .single()

    if (updateError || !updatedReply) {
      return {
        success: false,
        error: `Failed to update existing reply: ${updateError?.message}`,
      }
    }
    replyId = updatedReply.id
    actionTaken = 'edited'
  } else {
    // Insert initial reply
    const { data: newReply, error: insertError } = await supabase
      .from('review_replies')
      .insert({
        review_id: params.reviewId,
        workspace_id: params.workspaceId,
        user_id: user.id,
        content: params.content.trim(),
        tone: params.tone,
        is_ai_generated: params.isAiGenerated,
        status: targetInitialStatus,
      })
      .select('id')
      .single()

    if (insertError || !newReply) {
      return {
        success: false,
        error: `Failed to save reply: ${insertError?.message}`,
      }
    }
    replyId = newReply.id
    actionTaken = 'published'
  }

  // If manual approval gate is required and unconfirmed, do not publish to Google
  if (requiresManualGate) {
    await logReplyAudit(supabase, {
      workspaceId: params.workspaceId,
      reviewId: params.reviewId,
      replyId,
      userId: user.id,
      action: 'edited',
      content: params.content.trim(),
      tone: params.tone,
      metadata: {
        isAiGenerated: params.isAiGenerated,
        savedAsDraft: true,
        policyReason: policy.reason,
      },
    })

    revalidatePath('/dashboard', 'layout')
    revalidatePath('/dashboard/reviews', 'page')

    return {
      success: true,
      replyId,
      status: 'draft',
      message: isExplicitDraft ? 'Draft reply saved successfully.' : `Draft saved. ${policy.reason}`,
    }
  }

  // 4. If connected to Google Business Profile, attempt to publish reply to Google
  const locationData = targetReview.locations as unknown as {
    name?: string
    google_location_id?: string
    google_account_id?: string
    is_connected?: boolean
  } | null
  const googleLocationId = locationData?.google_location_id
  const googleAccountId = locationData?.google_account_id
  const externalReviewId = targetReview.external_review_id

  if (googleLocationId && externalReviewId) {
    // Verify location is connected AND workspace has strictly 1 active connected profile matching this review
    const { data: wsLocs } = await supabase
      .from('locations')
      .select('id')
      .eq('workspace_id', params.workspaceId)
      .eq('is_connected', true)

    if (!locationData?.is_connected || !wsLocs || wsLocs.length !== 1 || wsLocs[0].id !== targetReview.location_id) {
      return {
        success: false,
        replyId,
        status: 'draft',
        error:
          'Publishing paused: No active business profile is currently selected for this workspace. Please select a profile in Locations before publishing.',
      }
    }
    try {
      const googleRes = await publishGoogleReviewReply(
        supabase,
        params.workspaceId,
        googleLocationId,
        externalReviewId,
        params.content.trim(),
        googleAccountId
      )

      if (!googleRes.success) {
        // Failed publishing MUST NOT mark reply as published or review as answered
        await supabase
          .from('review_replies')
          .update({ status: 'failed', updated_at: new Date().toISOString() })
          .eq('id', replyId)

        await logReplyAudit(supabase, {
          workspaceId: params.workspaceId,
          reviewId: params.reviewId,
          replyId,
          userId: user.id,
          action: 'failed',
          content: params.content.trim(),
          tone: params.tone,
          errorMessage: googleRes.error,
          metadata: {
            googleSyncAttempted: true,
            error: googleRes.error,
          },
        })

        revalidatePath('/dashboard', 'layout')
        revalidatePath('/dashboard/reviews', 'page')

        return {
          success: false,
          replyId,
          status: 'failed',
          error: `Google Business Profile publishing failed: ${googleRes.error}. Reply saved as draft.`,
        }
      }
    } catch (gErr: unknown) {
      const msg = gErr instanceof Error ? gErr.message : 'Google API communication error'
      await supabase
        .from('review_replies')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', replyId)

      await logReplyAudit(supabase, {
        workspaceId: params.workspaceId,
        reviewId: params.reviewId,
        replyId,
        userId: user.id,
        action: 'failed',
        content: params.content.trim(),
        tone: params.tone,
        errorMessage: msg,
      })

      return {
        success: false,
        replyId,
        status: 'failed',
        error: `Google communication failure: ${msg}`,
      }
    }
  }

  // 5. Successful publish: Mark review as answered in public.reviews and reply as published
  await supabase
    .from('review_replies')
    .update({ status: 'published', updated_at: new Date().toISOString() })
    .eq('id', replyId)

  const { error: statusUpdateError } = await supabase
    .from('reviews')
    .update({ status: 'answered', updated_at: new Date().toISOString() })
    .eq('id', params.reviewId)
    .eq('workspace_id', params.workspaceId)

  if (statusUpdateError) {
    console.error('Warning: Failed to update review status:', statusUpdateError.message)
  }

  // 6. Record successful audit log
  await logReplyAudit(supabase, {
    workspaceId: params.workspaceId,
    reviewId: params.reviewId,
    replyId,
    userId: user.id,
    action: actionTaken,
    content: params.content.trim(),
    tone: params.tone,
    metadata: {
      isAiGenerated: params.isAiGenerated,
      googleSyncAttempted: Boolean(googleLocationId && externalReviewId),
      policyReason: policy.reason,
    },
  })

  revalidatePath('/dashboard', 'layout')
  revalidatePath('/dashboard/reviews', 'page')

  const baseMessage = actionTaken === 'edited' ? 'Reply successfully updated.' : 'Reply successfully published.'

  return {
    success: true,
    replyId,
    status: 'published',
    message: baseMessage,
  }
}

export interface AutoProcessReviewParams {
  reviewId: string
  workspaceId: string
  tone?: ReplyTone
  dryRun?: boolean
}

/**
 * Server Action: Automatically processes a review according to workspace safety rules.
 * Generates personalized AI replies for ANY rating (1-5 stars are never skipped).
 * Always saves a reply draft for low ratings or when approval is required.
 * Allows automatic publication only when explicitly permitted by the workspace owner.
 * Supports dryRun to verify logic safely without calling external Google APIs.
 */
export async function autoProcessReviewReplyAction(params: AutoProcessReviewParams) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return {
      success: false,
      error: 'You must be signed in to execute automated review processing.',
    }
  }

  // 1. Verify workspace membership & tenant isolation
  const membership = await verifyWorkspaceMembership(supabase, params.workspaceId)
  if (!membership.isMember) {
    return {
      success: false,
      error: membership.error || 'Unauthorized: Workspace access denied.',
    }
  }

  // 2. Execute review processing via core automation engine
  const result = await autoProcessSingleReview(supabase, {
    reviewId: params.reviewId,
    workspaceId: params.workspaceId,
    tone: params.tone,
    dryRun: params.dryRun,
    userId: user.id,
  })

  revalidatePath('/dashboard', 'layout')
  revalidatePath('/dashboard/reviews', 'page')

  return result
}

/**
 * Server Action: Fetches eligible reviews for the AI Reply Assistant.
 * Scoped to the workspace and optional active location.
 */
export async function getEligibleReviewsForAiAction(
  workspaceId: string,
  locationId?: string | null
): Promise<{
  success: boolean
  reviews: Array<{
    id: string
    author: string
    rating: number
    content: string
    date: string
    status: string
    location: string
    locationId: string | null
    reply?: string
    replyStatus?: string
  }>
  error?: string
}> {
  if (!workspaceId) {
    return { success: false, reviews: [], error: 'Workspace ID required.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, reviews: [], error: 'Not authenticated.' }
  }

  const membership = await verifyWorkspaceMembership(supabase, workspaceId)
  if (!membership.isMember) {
    return { success: false, reviews: [], error: 'Unauthorized.' }
  }

  let query = supabase
    .from('reviews')
    .select(`
      id,
      author_name,
      rating,
      content,
      review_date,
      status,
      location_id,
      locations ( name ),
      review_replies ( id, content, tone, status )
    `)
    .eq('workspace_id', workspaceId)
    .order('review_date', { ascending: false })
    .limit(30)

  if (locationId) {
    query = query.eq('location_id', locationId)
  }

  const { data, error } = await query

  if (error) {
    return { success: false, reviews: [], error: error.message }
  }

  const reviews = (data || []).map((r) => {
    const loc = r.locations as unknown as { name?: string } | null
    const replies = r.review_replies as unknown as Array<{
      id: string
      content: string
      tone: string
      status: string
    }> | null
    const reply = replies && replies.length > 0 ? replies[0] : null

    return {
      id: r.id,
      author: r.author_name || 'Customer',
      rating: r.rating,
      content: r.content || '',
      date: r.review_date,
      status: r.status,
      location: loc?.name || 'Google Business Profile',
      locationId: r.location_id,
      reply: reply?.content,
      replyStatus: reply?.status,
    }
  })

  return { success: true, reviews }
}

export interface AutomationStatusResult {
  isActive: boolean
  lastReceivedText: string | null
  lastPublishedText: string | null
  pendingCount: number
  failedCount: number
  userRole: string | null
  health: EvaluatedAutomationHealth | null
}

function formatShortTimestamp(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Server Action: Fetches real-time, evidence-based review automation health and operational metrics.
 * Distinguishes configured, connected (verified OAuth/GBP API), receiving (Pub/Sub),
 * processing (worker heartbeat + queue), and publishing (AI auto-replies only).
 */
export async function getAutomationStatusAction(workspaceId?: string): Promise<AutomationStatusResult> {
  const fallback: AutomationStatusResult = {
    isActive: false,
    lastReceivedText: null,
    lastPublishedText: null,
    pendingCount: 0,
    failedCount: 0,
    userRole: null,
    health: null,
  }

  if (!workspaceId) return fallback

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return fallback

  const membership = await verifyWorkspaceMembership(supabase, workspaceId)
  if (!membership.isMember) return fallback

  const settings = await getWorkspaceReplySettings(supabase, workspaceId)
  const isAutoConfigured = isFullyAutomaticModeActive(settings)

  // Parallel read-only health queries across all 5 pipeline stages
  const [
    integrationRes,
    connectedLocsRes,
    connHealthRes,
    latestPubSubEventRes,
    latestWorkerRunRes,
    scheduledJobsRes,
    processingJobsRes,
    failedJobsRes,
    deadLetterJobsRes,
    nextDueJobRes,
    latestAiPubRes,
    unansweredRevRes,
    failedReplyRes,
  ] = await Promise.all([
    supabase
      .from('google_integrations')
      .select('id, scope, refresh_token_encrypted')
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
    supabase
      .from('locations')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('is_connected', true),
    supabase
      .from('google_connection_health')
      .select(
        'status, last_refresh_succeeded_at, last_gbp_api_verified_at, last_checked_at, last_error_code, last_error_message'
      )
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
    supabase
      .from('review_automation_events')
      .select('created_at, processing_status')
      .eq('workspace_id', workspaceId)
      .in('event_type', ['NEW_REVIEW', 'UPDATED_REVIEW'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('automation_worker_runs')
      .select('started_at, completed_at, status')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('review_reply_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('status', 'scheduled'),
    supabase
      .from('review_reply_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('status', 'processing'),
    supabase
      .from('review_reply_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('status', 'failed'),
    supabase
      .from('review_reply_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('status', 'dead_letter'),
    supabase
      .from('review_reply_jobs')
      .select('scheduled_for')
      .eq('workspace_id', workspaceId)
      .eq('status', 'scheduled')
      .order('scheduled_for', { ascending: true })
      .limit(1)
      .maybeSingle(),
    // Strictly AI-generated published replies (NEVER imported historical merchant replies)
    supabase
      .from('review_replies')
      .select('created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('status', 'published')
      .eq('is_ai_generated', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('reviews')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('status', 'unanswered'),
    supabase
      .from('review_replies')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('status', 'failed'),
  ])

  const integration = integrationRes.data
  const scopes = integration?.scope ? integration.scope.split(' ') : []
  const hasRequiredScope = scopes.includes('https://www.googleapis.com/auth/business.manage')
  const connHealthData = connHealthRes.data

  const health = evaluateAutomationHealth({
    autoReplyMode: settings.autoReplyMode,
    requireApprovalForCritical: settings.requireApprovalForCritical,
    autoReplyDelayMinutes: settings.autoReplyDelayMinutes,
    isFullyAutomatic: isAutoConfigured,
    hasStoredIntegrationRow: Boolean(integration && integration.refresh_token_encrypted),
    hasRequiredBusinessManageScope: hasRequiredScope,
    connectedLocationCount: connectedLocsRes.count || 0,
    connectionHealthRow: connHealthData
      ? {
          status: connHealthData.status,
          lastRefreshSucceededAt: connHealthData.last_refresh_succeeded_at,
          lastGbpApiVerifiedAt: connHealthData.last_gbp_api_verified_at,
          lastCheckedAt: connHealthData.last_checked_at,
          lastErrorCode: connHealthData.last_error_code,
          lastErrorMessage: connHealthData.last_error_message,
        }
      : null,
    lastPubSubEventAt: latestPubSubEventRes.data?.created_at ?? null,
    lastPubSubEventStatus: latestPubSubEventRes.data?.processing_status ?? null,
    lastWorkerRunAt:
      latestWorkerRunRes.data?.completed_at ?? latestWorkerRunRes.data?.started_at ?? null,
    lastWorkerRunStatus: latestWorkerRunRes.data?.status ?? null,
    scheduledJobCount: scheduledJobsRes.count || 0,
    processingJobCount: processingJobsRes.count || 0,
    failedJobCount: failedJobsRes.count || 0,
    deadLetterJobCount: deadLetterJobsRes.count || 0,
    failedReplyCount: failedReplyRes.count || 0,
    nextScheduledFor: nextDueJobRes.data?.scheduled_for ?? null,
    lastAiAutoPublishedAt:
      latestAiPubRes.data?.updated_at ?? latestAiPubRes.data?.created_at ?? null,
    unansweredReviewCount: unansweredRevRes.count || 0,
  })

  return {
    isActive: isAutoConfigured,
    lastReceivedText: formatShortTimestamp(health.receiving.lastPubSubEventAt),
    lastPublishedText: formatShortTimestamp(health.publishing.lastAiAutoPublishedAt),
    pendingCount: health.processing.scheduledCount + health.processing.processingCount,
    failedCount: health.processing.failedCount,
    userRole: membership.role || null,
    health,
  }
}

/**
 * Server Action: Toggles the 24/7 review reply automation status from the Reviews Dashboard.
 */
export async function toggleAutomationAction(
  workspaceId: string,
  enable: boolean
): Promise<{ success: boolean; isActive?: boolean; error?: string }> {
  if (!workspaceId) return { success: false, error: 'Workspace ID is required.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'You must be signed in.' }

  const membership = await verifyWorkspaceMembership(supabase, workspaceId, ['owner', 'admin'])
  if (!membership.isMember) {
    return { success: false, error: 'Only workspace owners and administrators can change automation status.' }
  }

  const result = await toggleFullyAutomaticReplies(supabase, workspaceId, enable, user.id)
  if (!result.success) {
    return { success: false, error: result.error || 'Failed to toggle automation.' }
  }

  revalidatePath('/dashboard/reviews', 'page')
  revalidatePath('/dashboard/settings', 'page')

  return {
    success: true,
    isActive: result.settings ? isFullyAutomaticModeActive(result.settings) : false,
  }
}



