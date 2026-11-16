import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/supabase/admin'
import {
  getValidGoogleAccessToken,
  fetchSingleGoogleReview,
} from '@/lib/google-business'
import { autoProcessSingleReview } from '@/lib/reply-automation'
import { logReplyAudit } from '@/lib/reply-safety'

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

interface DecodedNotificationPayload {
  eventType?: string
  event_type?: string
  review?: {
    name?: string
    reviewId?: string
    starRating?: string
    comment?: string
    reviewer?: {
      displayName?: string
      profilePhotoUrl?: string
    }
    reviewReply?: {
      comment?: string
      updateTime?: string
    }
  }
  resourceName?: string
  resource_name?: string
  name?: string
  reviewName?: string
  review_name?: string
  accountId?: string
  locationId?: string
  reviewId?: string
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

  if (expectedToken && token !== expectedToken) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized: Invalid verification token' },
      { status: 401 }
    )
  }

  return NextResponse.json({
    status: 'ok',
    service: 'NexRep Google Business Profile Pub/Sub Push Webhook',
    eventDrivenAutomation: 'active',
    timestamp: new Date().toISOString(),
  })
}

/**
 * Google Cloud Pub/Sub Push Webhook Endpoint: /api/webhooks/google-pubsub
 *
 * Receives real-time Google Business Profile review notifications (NEW_REVIEW, UPDATED_REVIEW).
 * Automatically ingests reviews, generates contextual AI replies (1-5 stars),
 * and immediately publishes to Google when Fully Automatic AI Replies mode is enabled.
 */
export async function POST(request: NextRequest) {
  const url = new URL(request.url)
  const queryToken =
    url.searchParams.get('token') ||
    url.searchParams.get('verification_token')
  const headerToken = request.headers.get('x-goog-pubsub-verification-token')
  const authHeader = request.headers.get('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null

  const verificationToken = queryToken || headerToken || bearerToken
  const expectedToken = process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN

  // 1. Verify incoming Webhook Token if configured
  if (expectedToken && expectedToken.trim() !== '') {
    if (!verificationToken || verificationToken !== expectedToken) {
      console.warn('Google Pub/Sub webhook unauthorized: Token mismatch or missing.')
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Invalid Pub/Sub verification token' },
        { status: 401 }
      )
    }
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

  const eventType = (decodedPayload.eventType || decodedPayload.event_type || 'NEW_REVIEW').toUpperCase()

  // Only handle review events (NEW_REVIEW or UPDATED_REVIEW)
  if (eventType !== 'NEW_REVIEW' && eventType !== 'UPDATED_REVIEW') {
    return NextResponse.json({
      success: true,
      ignored: true,
      reason: `Ignored non-review event type: ${eventType}`,
    })
  }

  // 4. Resolve Resource Name (accounts/{accountId}/locations/{locationId}/reviews/{reviewId})
  const rawResourceName =
    decodedPayload.review?.name ||
    decodedPayload.resourceName ||
    decodedPayload.resource_name ||
    decodedPayload.name ||
    decodedPayload.reviewName ||
    decodedPayload.review_name ||
    ''

  let accountId = decodedPayload.accountId || ''
  let locationId = decodedPayload.locationId || ''
  let reviewId = decodedPayload.reviewId || decodedPayload.review?.reviewId || ''

  if (rawResourceName) {
    const clean = rawResourceName.replace(/^\/+/, '')
    const match = clean.match(/(?:accounts\/)?([^/]+)\/(?:locations\/)?([^/]+)\/(?:reviews\/)?([^/]+)/)
    if (match) {
      accountId = accountId || match[1]
      locationId = locationId || match[2]
      reviewId = reviewId || match[3]
    }
  }

  // Also check attributes if not found in payload
  if (body.message.attributes) {
    accountId = accountId || body.message.attributes.accountId || ''
    locationId = locationId || body.message.attributes.locationId || ''
    reviewId = reviewId || body.message.attributes.reviewId || ''
  }

  if (!locationId || !reviewId) {
    console.warn('Pub/Sub notification missing locationId or reviewId:', {
      rawResourceName,
      decodedPayload,
    })
    // Acknowledge with 200 so Pub/Sub does not redeliver unprocessable messages
    return NextResponse.json({
      success: false,
      acknowledged: true,
      error: 'Missing locationId or reviewId in notification payload',
    })
  }

  const supabase = createAdminClient()

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
        { success: false, error: 'Database query error' },
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

    // 6. Idempotency Check: Check if review reply was already published
    const { data: existingReview } = await supabase
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

    // Check if reply already published
    if (existingReview?.review_replies) {
      const replies = Array.isArray(existingReview.review_replies)
        ? existingReview.review_replies
        : [existingReview.review_replies]
      const hasPublishedReply = replies.some((r) => r.status === 'published')
      if (hasPublishedReply) {
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

    try {
      const { accessToken } = await getValidGoogleAccessToken(supabase, workspaceId)
      const gbpReviewRes = await fetchSingleGoogleReview(accessToken, {
        accountId: cleanAccountId || activeLoc.google_account_id || '',
        locationId: cleanLocationId || activeLoc.google_location_id || '',
        reviewId,
      })

      if (gbpReviewRes.success && gbpReviewRes.review) {
        fetchedReviewData = gbpReviewRes.review
      }
    } catch (tokenErr: unknown) {
      console.warn('Could not fetch review from Google API via access token:', tokenErr)
      // If token refresh fails due to revoked grant, log and continue with fallback payload if available
    }

    // Fallback: If live fetch failed but payload embedded review details, use payload
    if (!fetchedReviewData && decodedPayload.review) {
      const pr = decodedPayload.review
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
      return NextResponse.json({
        success: false,
        acknowledged: true,
        error: 'Unable to fetch or extract review details from Google API or payload.',
      })
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
      await supabase
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
      action: processResult.status === 'published' ? 'published' : 'generated',
      content: processResult.replyContent || null,
      metadata: {
        eventDrivenPubSub: true,
        pubsubMessageId: messageId,
        eventType,
        rating: fetchedReviewData.rating,
        status: processResult.status,
        requiresApproval: processResult.requiresApproval,
      },
    })

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

    // Acknowledge Pub/Sub delivery even if downstream fails, to prevent infinite Pub/Sub redelivery storms
    return NextResponse.json({
      success: false,
      acknowledged: true,
      error: errorMsg,
    })
  }
}
