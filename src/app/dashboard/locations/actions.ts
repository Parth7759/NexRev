'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/utils/supabase/server'
import { verifyWorkspaceMembership } from '@/lib/workspace'
import {
  getValidGoogleAccessToken,
  fetchGoogleAccounts,
  fetchGoogleLocations,
  fetchGoogleReviews,
  GoogleApiError,
} from '@/lib/google-business'
import { autoProcessSingleReview } from '@/lib/reply-automation'

export interface SyncLocationsResult {
  success: boolean
  locationsCount: number
  reviewsCount: number
  message: string
  reviewsMessage?: string
  error?: string
}

/**
 * Server-side synchronization of Google Business Profile accounts, locations, and reviews.
 * Scoped securely to the authenticated user and authorized workspace.
 */
export async function syncGoogleLocationsAction(
  workspaceId: string
): Promise<SyncLocationsResult> {
  if (!workspaceId) {
    return {
      success: false,
      locationsCount: 0,
      reviewsCount: 0,
      message: '',
      error: 'Workspace ID is required for synchronization.',
    }
  }

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    // 1. Verify user authentication & workspace authorization
    const membershipCheck = await verifyWorkspaceMembership(supabase, workspaceId, [
      'owner',
      'admin',
    ])
    if (!membershipCheck.isMember) {
      return {
        success: false,
        locationsCount: 0,
        reviewsCount: 0,
        message: '',
        error:
          membershipCheck.error ||
          'You do not have administrative permission to sync integrations for this workspace.',
      }
    }

    // 2. Obtain valid Google access token (auto-refreshes if needed using AES-256-GCM refresh token)
    const { accessToken } = await getValidGoogleAccessToken(supabase, workspaceId)

    // 3. Fetch accessible Google Business Profile accounts
    const accounts = await fetchGoogleAccounts(accessToken)
    if (!accounts || accounts.length === 0) {
      return {
        success: true,
        locationsCount: 0,
        reviewsCount: 0,
        message:
          'Connected to Google Business Profile, but no business accounts were returned for this Google user. Ensure your Google account has verified business locations.',
      }
    }

    let totalLocationsSynced = 0
    let totalReviewsSynced = 0
    const reviewMessages: string[] = []

    // 4. For each account, fetch locations and upsert into public.locations
    for (const account of accounts) {
      const locations = await fetchGoogleLocations(accessToken, account.name)

      for (const loc of locations) {
        // Safe repeat syncing: Check if location already exists in workspace
        const { data: existingLoc } = await supabase
          .from('locations')
          .select('id')
          .eq('workspace_id', workspaceId)
          .eq('google_location_id', loc.googleLocationId)
          .maybeSingle()

        let locationDbId: string | null = null

        if (existingLoc?.id) {
          // Update existing location record
          const { data: updated } = await supabase
            .from('locations')
            .update({
              name: loc.name,
              address: loc.address,
              phone: loc.phone,
              google_place_id: loc.googlePlaceId,
              google_account_id: loc.googleAccountId,
              is_connected: true,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingLoc.id)
            .select('id')
            .single()

          locationDbId = updated?.id || existingLoc.id
        } else {
          // Insert new location record
          const { data: inserted } = await supabase
            .from('locations')
            .insert({
              workspace_id: workspaceId,
              name: loc.name,
              address: loc.address,
              phone: loc.phone,
              google_place_id: loc.googlePlaceId,
              google_account_id: loc.googleAccountId,
              google_location_id: loc.googleLocationId,
              is_connected: true,
            })
            .select('id')
            .single()

          locationDbId = inserted?.id || null
        }

        totalLocationsSynced++

        // 5. Attempt review sync for this location if available
        if (locationDbId) {
          const reviewsResult = await fetchGoogleReviews(
            accessToken,
            account.name,
            loc.googleLocationId
          )

          if (reviewsResult.message && !reviewMessages.includes(reviewsResult.message)) {
            reviewMessages.push(reviewsResult.message)
          }

          if (reviewsResult.supported && reviewsResult.reviews.length > 0) {
            for (const rev of reviewsResult.reviews) {
              const sentiment: 'positive' | 'neutral' | 'negative' =
                rev.rating >= 4 ? 'positive' : rev.rating === 3 ? 'neutral' : 'negative'
              const status: 'unanswered' | 'answered' = rev.reply ? 'answered' : 'unanswered'

              // Check if review already exists
              const { data: existingReview } = await supabase
                .from('reviews')
                .select('id')
                .eq('workspace_id', workspaceId)
                .eq('external_review_id', rev.reviewId)
                .maybeSingle()

              let reviewDbId: string | null = null

              if (existingReview?.id) {
                const { data: updatedRev } = await supabase
                  .from('reviews')
                  .update({
                    location_id: locationDbId,
                    workspace_id: workspaceId,
                    author_name: rev.authorName,
                    author_photo_url: rev.authorPhotoUrl,
                    rating: rev.rating,
                    content: rev.content,
                    review_date: rev.reviewDate,
                    status,
                    sentiment,
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', existingReview.id)
                  .select('id')
                  .single()

                reviewDbId = updatedRev?.id || existingReview.id
              } else {
                const { data: insertedRev } = await supabase
                  .from('reviews')
                  .insert({
                    workspace_id: workspaceId,
                    location_id: locationDbId,
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

                reviewDbId = insertedRev?.id || null
              }

              totalReviewsSynced++

              // If Google returned an existing reply, store in public.review_replies
              if (reviewDbId && rev.reply?.comment) {
                const { data: existingReply } = await supabase
                  .from('review_replies')
                  .select('id')
                  .eq('review_id', reviewDbId)
                  .maybeSingle()

                if (existingReply?.id) {
                  await supabase
                    .from('review_replies')
                    .update({
                      content: rev.reply.comment,
                      updated_at: new Date().toISOString(),
                    })
                    .eq('id', existingReply.id)
                } else {
                  await supabase.from('review_replies').insert({
                    review_id: reviewDbId,
                    workspace_id: workspaceId,
                    content: rev.reply.comment,
                    is_ai_generated: false,
                    status: 'published',
                  })
                }
              } else if (reviewDbId && !rev.reply?.comment) {
                // Newly synced review is unanswered: automatically generate personalized reply
                // and save as draft / publish according to workspace owner's safety policy
                try {
                  await autoProcessSingleReview(supabase, {
                    reviewId: reviewDbId,
                    workspaceId,
                    userId: user?.id || null,
                  })
                } catch (autoErr) {
                  console.warn(`Auto-reply processing skipped for review ${reviewDbId}:`, autoErr)
                }
              }
            }
          }
        }
      }
    }

    // 6. Update google_integrations timestamp
    await supabase
      .from('google_integrations')
      .update({ updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)

    // 7. Revalidate relevant dashboard pages
    revalidatePath('/dashboard/locations')
    revalidatePath('/dashboard/reviews')
    revalidatePath('/dashboard')

    const message =
      totalLocationsSynced > 0
        ? `Successfully synced ${totalLocationsSynced} location${
            totalLocationsSynced === 1 ? '' : 's'
          } from Google Business Profile.`
        : 'Google API connection verified, but no locations were found in your Google Business Profile account.'

    return {
      success: true,
      locationsCount: totalLocationsSynced,
      reviewsCount: totalReviewsSynced,
      message,
      reviewsMessage: reviewMessages.join(' '),
    }
  } catch (err: unknown) {
    if (err instanceof GoogleApiError) {
      return {
        success: false,
        locationsCount: 0,
        reviewsCount: 0,
        message: '',
        error: err.message,
      }
    }
    const msg = err instanceof Error ? err.message : 'An unexpected error occurred during sync.'
    return {
      success: false,
      locationsCount: 0,
      reviewsCount: 0,
      message: '',
      error: msg,
    }
  }
}
