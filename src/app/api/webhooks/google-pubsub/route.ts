import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/supabase/admin'
import {
  getValidGoogleAccessToken,
  fetchSingleGoogleReview,
} from '@/lib/google-business'
import { autoProcessSingleReview } from '@/lib/reply-automation'
import { logReplyAudit, TypedSupabaseClient } from '@/lib/reply-safety'
import { Database } from '@/types/database.types'
import { authenticateGooglePubSubWebhook } from '@/lib/google-pubsub-auth'
import {
  DecodedNotificationPayload,
  parseGooglePubSubNotificationPayload,
} from '@/lib/google-pubsub-payload'

interface PubSubPushBody {
  message?: {
    attributes?: Record<string, string>
    data?: string
    messageId?: string
    message_id?: string
    publishTime?: string
    publish_time?: string
  }
  subscription?: string
}

/**
 * Health check and webhook verification handler.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const token =
    url.searchParams.get('token') ||
    url.searchParams.get('verification_token') ||
    request.headers.get('x-goog-pubsub-verification-token')

  const expectedToken = process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN

  if (expectedToken && expectedToken.trim() !== '' && token !== expectedToken) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized: Invalid verification token' },
      { status: 401 }
    )
  }

  return NextResponse.json({
    status: 'ok',
    service: 'NexRep Google Business Profile Pub/Sub Push Webhook',
    eventDrivenAutomation: 'active',
    authConfig: {
      oidcConfigured: Boolean(
        process.env.GOOGLE_PUBSUB_PUSH_AUDIENCE || process.env.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT
      ),
      tokenConfigured: Boolean(expectedToken && expectedToken.trim() !== ''),
    },
    timestamp: new Date().toISOString(),
  })
}

/**
 * Safely persists database-backed job and event state to review_automation_events.
 * Gracefully ignores errors if table is not yet migrated, ensuring zero disruption.
 */
async function recordAutomationEvent(
  supabase: TypedSupabaseClient,
  params: {
    eventId: string
    reviewResourceId?: string | null
    workspaceId: string
    locationId?: string | null
    reviewId?: string | null
    eventType: 'NEW_REVIEW' | 'UPDATED_REVIEW' | 'SYNC_RECONCILIATION'
    processingStatus: 'received' | 'ai_generating' | 'publishing' | 'published' | 'failed' | 'skipped' | 'draft_saved'
    aiGeneratedReply?: string | null
    publishingStatus?: 'pending' | 'published' | 'failed' | 'skipped' | 'draft_saved'
    retryCount?: number
    errorMessage?: string | null
    metadata?: Record<string, unknown>
  }
) {
  try {
    await supabase.from('review_automation_events').upsert(
      {
        event_id: params.eventId,
        review_resource_id: params.reviewResourceId || null,
        workspace_id: params.workspaceId,
        location_id: params.locationId || null,
        review_id: params.reviewId || null,
        event_type: params.eventType,
        processing_status: params.processingStatus,
        ai_generated_reply: params.aiGeneratedReply || null,
        publishing_status: params.publishingStatus || 'pending',
        retry_count: params.retryCount ?? 0,
        error_message: params.errorMessage || null,
        metadata: (params.metadata || {}) as Database['public']['Tables']['review_automation_events']['Insert']['metadata'],
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'event_id' }
    )
  } catch (err) {
    // Non-blocking fallback to review_reply_logs
    console.warn('Failed to record review_automation_events entry (falling back to review_reply_logs):', err)
  }
}

/**
 * Google Cloud Pub/Sub Push Webhook Endpoint: /api/webhooks/google-pubsub
 *
 * Receives real-time Google Business Profile review notifications (NEW_REVIEW, UPDATED_REVIEW).
 * Automatically ingests reviews, generates contextual AI replies (1-5 stars),
 * and immediately publishes to Google when Fully Automatic AI Replies mode is enabled.
 */
export async function POST(request: NextRequest) {
  // 1. Authenticate incoming request via Google-signed OIDC JWT and/or verification token
  const auth = await authenticateGooglePubSubWebhook(request)
  if (!auth.authenticated) {
    console.warn('Google Pub/Sub webhook unauthorized:', auth.error)
    return NextResponse.json(
      { success: false, error: auth.error || 'Unauthorized: Invalid Pub/Sub authentication' },
      { status: auth.status || 401 }
    )
  }

  // 2. Parse Pub/Sub push message payload
  let body: PubSubPushBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, error: 'Bad Request: Invalid JSON body' },
      { status: 400 }
    )
  }

  if (!body?.message || !body.message.data) {
    return NextResponse.json(
      { success: false, error: 'Bad Request: Missing message or message.data' },
      { status: 400 }
    )
  }

  const messageId = body.message.messageId || body.message.message_id || `msg-${Date.now()}`
  const publishTime = body.message.publishTime || body.message.publish_time || new Date().toISOString()

  // 3. Decode Base64 data
  let decodedPayload: DecodedNotificationPayload
  try {
    const rawData = Buffer.from(body.message.data, 'base64').toString('utf-8')
    decodedPayload = JSON.parse(rawData)
  } catch (err) {
    console.error('Failed to decode Pub/Sub base64 payload:', err)
    return NextResponse.json(
      { success: false, error: 'Invalid Base64 payload encoding' },
      { status: 400 }
    )
  }

  const parsed = parseGooglePubSubNotificationPayload(decodedPayload, body.message.attributes)
  const { eventType, isReviewEvent, accountId, locationId, reviewId, rawResourceName, embeddedReview } =
    parsed

  // Only handle review events (NEW_REVIEW or UPDATED_REVIEW)
  if (!isReviewEvent) {
    return NextResponse.json({
      success: true,
      acknowledged: true,
      ignored: true,
      reason: `Ignored non-review event type: ${eventType}`,
    })
  }

  // 4. Validate resolved identifiers (accounts/{accountId}/locations/{locationId}/reviews/{reviewId})
  if (!parsed.hasRequiredIdentifiers) {
    console.warn('Pub/Sub notification missing locationId or reviewId:', {
      messageId,
      eventType,
      rawResourceName,
      locationResourceName: parsed.locationResourceName,
      diagnostics: parsed.diagnosticSummary,
    })
    // Acknowledge genuinely malformed / incomplete payloads so Pub/Sub does not redeliver forever
    return NextResponse.json({
      success: false,
      acknowledged: true,
      ignored: true,
      error: 'Missing locationId or reviewId in notification payload',
    })
  }

  const supabase = createAdminClient()
  let resolvedWorkspaceId: string | null = null
  let resolvedLocationDbId: string | null = null
  let currentRetryCount = 0

  try {
    // 5. Match location in NexRep database
    // Normalize IDs for matching
    const cleanLocationId = locationId.replace(/^locations\//, '')
    const cleanAccountId = accountId.replace(/^accounts\//, '')

    const { data: matchedLocations, error: locQueryError } = await supabase
      .from('locations')
      .select('id, workspace_id, name, google_location_id, google_account_id, is_connected')
      .or(`google_location_id.eq.${cleanLocationId},google_location_id.eq.locations/${cleanLocationId}`)

    if (locQueryError) {
      console.error('Error querying locations table:', locQueryError.message)
      return NextResponse.json(
        { success: false, retryable: true, error: 'Database query error' },
        { status: 500 }
      )
    }

    if (!matchedLocations || matchedLocations.length === 0) {
      // Unrecognized location in NexRep — acknowledge so Pub/Sub drops message
      return NextResponse.json({
        success: true,
        acknowledged: true,
        ignored: true,
        reason: `Location ${cleanLocationId} is not registered in this NexRep environment`,
      })
    }

    // Filter to actively connected location
    const activeLoc = matchedLocations.find((l) => l.is_connected) || matchedLocations[0]
    const workspaceId = activeLoc.workspace_id
    resolvedWorkspaceId = workspaceId
    resolvedLocationDbId = activeLoc.id

    // 5b. Event-level duplicate protection (Pub/Sub at-least-once delivery)
    const { data: existingEvent } = await supabase
      .from('review_automation_events')
      .select('event_id, processing_status, retry_count, review_id')
      .eq('event_id', messageId)
      .maybeSingle()

    if (
      existingEvent &&
      (existingEvent.processing_status === 'published' ||
        existingEvent.processing_status === 'draft_saved' ||
        existingEvent.processing_status === 'skipped')
    ) {
      return NextResponse.json({
        success: true,
        acknowledged: true,
        duplicate: true,
        skipped: true,
        messageId,
        reviewId: existingEvent.review_id,
        reason: `Duplicate Pub/Sub event already processed (status: ${existingEvent.processing_status}).`,
      })
    }

    currentRetryCount = existingEvent ? (existingEvent.retry_count ?? 0) + 1 : 0

    // Initial event record in review_automation_events
    await recordAutomationEvent(supabase, {
      eventId: messageId,
      reviewResourceId: rawResourceName || reviewId,
      workspaceId,
      locationId: activeLoc.id,
      eventType: eventType === 'UPDATED_REVIEW' ? 'UPDATED_REVIEW' : 'NEW_REVIEW',
      processingStatus: 'received',
      retryCount: currentRetryCount,
      metadata: {
        oidcVerified: Boolean(auth.claims),
        serviceAccount: auth.claims?.email || null,
      },
    })

    // 6. Idempotency Check: Check if review reply was already published
    const { data: existingReview, error: existingReviewError } = await supabase
      .from('reviews')
      .select(`
        id,
        workspace_id,
        status,
        rating,
        content,
        external_review_id,
        review_replies (
          id,
          status,
          content,
          is_ai_generated
        )
      `)
      .eq('workspace_id', workspaceId)
      .eq('external_review_id', reviewId)
      .maybeSingle()

    if (existingReviewError) {
      throw new Error(`Failed to query existing review: ${existingReviewError.message}`)
    }

    // Check if reply already published
    if (existingReview?.review_replies) {
      const replies = Array.isArray(existingReview.review_replies)
        ? existingReview.review_replies
        : [existingReview.review_replies]
      const hasPublishedReply = replies.some((r) => r.status === 'published')
      if (hasPublishedReply) {
        await recordAutomationEvent(supabase, {
          eventId: messageId,
          reviewResourceId: rawResourceName || reviewId,
          workspaceId,
          locationId: activeLoc.id,
          reviewId: existingReview.id,
          eventType: eventType === 'UPDATED_REVIEW' ? 'UPDATED_REVIEW' : 'NEW_REVIEW',
          processingStatus: 'skipped',
          publishingStatus: 'skipped',
          retryCount: currentRetryCount,
          metadata: { reason: 'Review already has a published reply.' },
        })

        return NextResponse.json({
          success: true,
          acknowledged: true,
          skipped: true,
          reason: 'Review already has a published reply.',
          reviewId: existingReview.id,
        })
      }
    }

    // 7. Obtain Google Access Token and Fetch Fresh Review Details
    let fetchedReviewData: {
      authorName: string
      authorPhotoUrl: string | null
      rating: number
      content: string
      reviewDate: string
      reply?: { comment: string; updateTime?: string }
    } | null = null
    let googleFetchError: string | null = null

    try {
      const { accessToken } = await getValidGoogleAccessToken(supabase, workspaceId)
      const gbpReviewRes = await fetchSingleGoogleReview(accessToken, {
        accountId: cleanAccountId || activeLoc.google_account_id || '',
        locationId: cleanLocationId || activeLoc.google_location_id || '',
        reviewId,
      })

      if (gbpReviewRes.success && gbpReviewRes.review) {
        fetchedReviewData = gbpReviewRes.review
      } else if (gbpReviewRes.error) {
        googleFetchError = gbpReviewRes.error
      }
    } catch (tokenErr: unknown) {
      googleFetchError = tokenErr instanceof Error ? tokenErr.message : 'Failed to fetch review from Google API'
      console.warn('Could not fetch review from Google API via access token:', googleFetchError)
      // Continue to fallback payload if available
    }

    // Fallback: If live fetch failed but payload embedded review details object, use payload
    if (!fetchedReviewData && embeddedReview) {
      const pr = embeddedReview
      let ratingNum = 5
      if (pr.starRating) {
        switch (pr.starRating) {
          case 'ONE': ratingNum = 1; break
          case 'TWO': ratingNum = 2; break
          case 'THREE': ratingNum = 3; break
          case 'FOUR': ratingNum = 4; break
          case 'FIVE': ratingNum = 5; break
          default: ratingNum = 5; break
        }
      }
      fetchedReviewData = {
        authorName: pr.reviewer?.displayName || 'Google Customer',
        authorPhotoUrl: pr.reviewer?.profilePhotoUrl || null,
        rating: ratingNum,
        content: pr.comment || '',
        reviewDate: publishTime,
        reply: pr.reviewReply?.comment
          ? { comment: pr.reviewReply.comment, updateTime: pr.reviewReply.updateTime }
          : undefined,
      }
    }

    if (!fetchedReviewData) {
      const isPermanentNotFound = Boolean(
        googleFetchError && (googleFetchError.includes('404') || googleFetchError.includes('NOT_FOUND'))
      )

      await recordAutomationEvent(supabase, {
        eventId: messageId,
        reviewResourceId: rawResourceName || reviewId,
        workspaceId,
        locationId: activeLoc.id,
        eventType: eventType === 'UPDATED_REVIEW' ? 'UPDATED_REVIEW' : 'NEW_REVIEW',
        processingStatus: isPermanentNotFound ? 'skipped' : 'failed',
        publishingStatus: isPermanentNotFound ? 'skipped' : 'failed',
        retryCount: currentRetryCount,
        errorMessage: googleFetchError || 'Unable to fetch review details from Google API.',
        metadata: {
          oidcVerified: Boolean(auth.claims),
          serviceAccount: auth.claims?.email || null,
          retryable: !isPermanentNotFound,
        },
      })

      if (isPermanentNotFound) {
        return NextResponse.json({
          success: true,
          acknowledged: true,
          skipped: true,
          reason: 'Review no longer exists on Google Business Profile (404).',
        })
      }

      // Return retryable 500 so Pub/Sub retries transient Google API / token failures
      return NextResponse.json(
        {
          success: false,
          retryable: true,
          error: googleFetchError || 'Unable to fetch review details from Google API.',
        },
        { status: 500 }
      )
    }

    // CRITICAL SAFETY CHECK: External merchant reply protection
    // If the review already has a reply posted by merchant directly on Google, do NOT overwrite it!
    if (fetchedReviewData.reply?.comment) {
      // Upsert review as answered
      const sentiment =
        fetchedReviewData.rating >= 4 ? 'positive' : fetchedReviewData.rating === 3 ? 'neutral' : 'negative'

      let reviewDbId = existingReview?.id

      if (!reviewDbId) {
        const { data: insertedRev } = await supabase
          .from('reviews')
          .insert({
            workspace_id: workspaceId,
            location_id: activeLoc.id,
            author_name: fetchedReviewData.authorName,
            author_photo_url: fetchedReviewData.authorPhotoUrl,
            rating: fetchedReviewData.rating,
            content: fetchedReviewData.content,
            review_date: fetchedReviewData.reviewDate,
            source: 'google',
            status: 'answered',
            sentiment,
            external_review_id: reviewId,
          })
          .select('id')
          .single()

        reviewDbId = insertedRev?.id
      } else {
        await supabase
          .from('reviews')
          .update({
            status: 'answered',
            rating: fetchedReviewData.rating,
            content: fetchedReviewData.content,
            updated_at: new Date().toISOString(),
          })
          .eq('id', reviewDbId)
      }

      if (reviewDbId) {
        // Upsert the external merchant reply
        await supabase.from('review_replies').upsert(
          {
            review_id: reviewDbId,
            workspace_id: workspaceId,
            content: fetchedReviewData.reply.comment,
            status: 'published',
            is_ai_generated: false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'review_id' }
        )

        await recordAutomationEvent(supabase, {
          eventId: messageId,
          reviewResourceId: rawResourceName || reviewId,
          workspaceId,
          locationId: activeLoc.id,
          reviewId: reviewDbId,
          eventType: eventType === 'UPDATED_REVIEW' ? 'UPDATED_REVIEW' : 'NEW_REVIEW',
          processingStatus: 'skipped',
          publishingStatus: 'skipped',
          metadata: { reason: 'Review already has an existing merchant reply directly from Google. Overwrite prevented.' },
        })
      }

      return NextResponse.json({
        success: true,
        acknowledged: true,
        skipped: true,
        reason: 'Review already has an existing merchant reply directly from Google. Overwrite prevented.',
      })
    }

    // 8. Upsert review into NexRep reviews table
    const sentiment =
      fetchedReviewData.rating >= 4 ? 'positive' : fetchedReviewData.rating === 3 ? 'neutral' : 'negative'

    let reviewDbId = existingReview?.id

    if (!reviewDbId) {
      const { data: insertedRev, error: insertError } = await supabase
        .from('reviews')
        .insert({
          workspace_id: workspaceId,
          location_id: activeLoc.id,
          author_name: fetchedReviewData.authorName,
          author_photo_url: fetchedReviewData.authorPhotoUrl,
          rating: fetchedReviewData.rating,
          content: fetchedReviewData.content,
          review_date: fetchedReviewData.reviewDate,
          source: 'google',
          status: 'unanswered',
          sentiment,
          external_review_id: reviewId,
        })
        .select('id')
        .single()

      if (insertError) {
        throw new Error(`Failed to insert review: ${insertError.message}`)
      }
      reviewDbId = insertedRev.id
    } else {
      // Update review content/rating if customer updated it
      const { error: updateError } = await supabase
        .from('reviews')
        .update({
          rating: fetchedReviewData.rating,
          content: fetchedReviewData.content,
          author_name: fetchedReviewData.authorName,
          author_photo_url: fetchedReviewData.authorPhotoUrl,
          review_date: fetchedReviewData.reviewDate,
          sentiment,
          updated_at: new Date().toISOString(),
        })
        .eq('id', reviewDbId)

      if (updateError) {
        throw new Error(`Failed to update review: ${updateError.message}`)
      }
    }

    // 9. Automatically Process Review & Publish Reply
    // autoProcessSingleReview evaluates workspace safety policy:
    // When "Fully Automatic AI Replies (All 1-5 Stars)" is active, it generates contextual AI reply
    // and immediately publishes to Google via publishGoogleReviewReply.
    const processResult = await autoProcessSingleReview(supabase, {
      reviewId: reviewDbId,
      workspaceId,
      dryRun: false,
    })

    // Record Pub/Sub delivery in audit trail metadata
    await logReplyAudit(supabase, {
      workspaceId,
      reviewId: reviewDbId,
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
        eventDrivenPubSub: true,
        pubsubMessageId: messageId,
        eventType,
        rating: fetchedReviewData.rating,
        status: processResult.status,
        requiresApproval: processResult.requiresApproval,
      },
    })

    const isProcessingFailure = !processResult.success && !processResult.skipped
    const pubStatus: 'published' | 'failed' | 'draft_saved' | 'skipped' =
      processResult.status === 'published'
        ? 'published'
        : isProcessingFailure || processResult.status === 'failed'
          ? 'failed'
          : processResult.skipped && !processResult.replyId
            ? 'skipped'
            : 'draft_saved'

    await recordAutomationEvent(supabase, {
      eventId: messageId,
      reviewResourceId: rawResourceName || reviewId,
      workspaceId,
      locationId: activeLoc.id,
      reviewId: reviewDbId,
      eventType: eventType === 'UPDATED_REVIEW' ? 'UPDATED_REVIEW' : 'NEW_REVIEW',
      processingStatus: pubStatus,
      aiGeneratedReply: processResult.replyContent || null,
      publishingStatus: pubStatus,
      retryCount: currentRetryCount,
      errorMessage: processResult.error || null,
      metadata: {
        rating: fetchedReviewData.rating,
        policyReason: processResult.reason,
        requiresApproval: processResult.requiresApproval,
        oidcVerified: Boolean(auth.claims),
        serviceAccount: auth.claims?.email || null,
      },
    })

    if (isProcessingFailure) {
      return NextResponse.json(
        {
          success: false,
          retryable: true,
          messageId,
          eventType,
          rating: fetchedReviewData.rating,
          replyStatus: processResult.status || 'failed',
          error: processResult.error || 'Failed to process review reply',
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: processResult.success,
      acknowledged: true,
      messageId,
      eventType,
      rating: fetchedReviewData.rating,
      replyStatus: processResult.status,
      published: processResult.status === 'published',
      reason: processResult.reason,
    })
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Internal webhook processing failure'
    console.error('Pub/Sub webhook processing error:', errorMsg)

    if (resolvedWorkspaceId) {
      await recordAutomationEvent(supabase, {
        eventId: messageId,
        reviewResourceId: rawResourceName || reviewId,
        workspaceId: resolvedWorkspaceId,
        locationId: resolvedLocationDbId,
        eventType: eventType === 'UPDATED_REVIEW' ? 'UPDATED_REVIEW' : 'NEW_REVIEW',
        processingStatus: 'failed',
        publishingStatus: 'failed',
        retryCount: currentRetryCount,
        errorMessage: errorMsg,
        metadata: {
          retryable: true,
          oidcVerified: Boolean(auth.claims),
          serviceAccount: auth.claims?.email || null,
        },
      })
    }

    // Return retryable HTTP 500 so Google Cloud Pub/Sub retries transient DB/infrastructure failures
    return NextResponse.json(
      {
        success: false,
        retryable: true,
        error: errorMsg,
      },
      { status: 500 }
    )
  }
}
