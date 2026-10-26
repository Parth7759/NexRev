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

export interface GoogleLocationProfile {
  googleLocationId: string
  name: string
  address: string | null
  phone: string | null
  googlePlaceId: string | null
  googleAccountId: string
  accountTitle?: string
}

export interface AvailableProfilesResult {
  success: boolean
  profiles: GoogleLocationProfile[]
  accountName?: string
  error?: string
}

export interface SelectProfileResult {
  success: boolean
  locationId?: string
  name?: string
  reviewsSynced?: number
  message?: string
  error?: string
}

export interface SyncLocationsResult {
  success: boolean
  locationsCount: number
  reviewsCount: number
  message: string
  reviewsMessage?: string
  error?: string
}

/**
 * 1. Fetch business locations available to the authenticated Google account
 * WITHOUT saving or activating them in the database.
 * Used for the business profile selection screen.
 */
export async function getAvailableGoogleProfilesAction(
  workspaceId: string
): Promise<AvailableProfilesResult> {
  if (!workspaceId) {
    return { success: false, profiles: [], error: 'Workspace ID is required.' }
  }

  try {
    const supabase = await createClient()

    // Verify user authorization (owner or admin)
    const membershipCheck = await verifyWorkspaceMembership(supabase, workspaceId, [
      'owner',
      'admin',
    ])
    if (!membershipCheck.isMember) {
      return {
        success: false,
        profiles: [],
        error:
          membershipCheck.error ||
          'You do not have administrative permission to manage integrations for this workspace.',
      }
    }

    // Get valid decrypted Google access token
    const { accessToken, accountName } = await getValidGoogleAccessToken(supabase, workspaceId)

    // Fetch accounts
    const accounts = await fetchGoogleAccounts(accessToken)
    if (!accounts || accounts.length === 0) {
      return {
        success: true,
        profiles: [],
        accountName: accountName || undefined,
      }
    }

    const availableProfiles: GoogleLocationProfile[] = []

    // For each account, fetch locations from Google Business Information API
    for (const acc of accounts) {
      const locations = await fetchGoogleLocations(accessToken, acc.name)
      for (const loc of locations) {
        availableProfiles.push({
          googleLocationId: loc.googleLocationId,
          name: loc.name,
          address: loc.address,
          phone: loc.phone,
          googlePlaceId: loc.googlePlaceId,
          googleAccountId: loc.googleAccountId || acc.name,
          accountTitle: acc.accountName || acc.name,
        })
      }
    }

    return {
      success: true,
      profiles: availableProfiles,
      accountName: accountName || undefined,
    }
  } catch (err: unknown) {
    if (err instanceof GoogleApiError) {
      return { success: false, profiles: [], error: err.message }
    }
    const msg = err instanceof Error ? err.message : 'Failed to fetch Google Business Profiles'
    return { success: false, profiles: [], error: msg }
  }
}

/**
 * 2. Save and activate ONLY the selected business profile for this workspace.
 * Deactivates all other locations for this workspace, sets is_connected = true ONLY on the selected profile,
 * and syncs reviews strictly for this location.
 */
export async function selectSingleGoogleProfileAction(
  workspaceId: string,
  profile: GoogleLocationProfile
): Promise<SelectProfileResult> {
  if (!workspaceId || !profile || !profile.googleLocationId) {
    return {
      success: false,
      error: 'Workspace ID and valid profile data are required.',
    }
  }

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    // 1. Verify workspace admin/owner role
    const membershipCheck = await verifyWorkspaceMembership(supabase, workspaceId, [
      'owner',
      'admin',
    ])
    if (!membershipCheck.isMember) {
      return {
        success: false,
        error:
          membershipCheck.error ||
          'You do not have administrative permission to configure integrations for this workspace.',
      }
    }

    // 2. Deactivate any existing connected locations for this workspace
    // Ensures strictly ONE connected business profile per workspace
    await supabase
      .from('locations')
      .update({
        is_connected: false,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)

    // 3. Upsert ONLY the selected profile into public.locations with is_connected = true
    const { data: existingLoc } = await supabase
      .from('locations')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('google_location_id', profile.googleLocationId)
      .maybeSingle()

    let locationDbId: string

    if (existingLoc?.id) {
      const { data: updated, error: updateError } = await supabase
        .from('locations')
        .update({
          name: profile.name,
          address: profile.address,
          phone: profile.phone,
          google_place_id: profile.googlePlaceId,
          google_account_id: profile.googleAccountId,
          is_connected: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingLoc.id)
        .select('id')
        .single()

      if (updateError || !updated) {
        throw new Error(updateError?.message || 'Failed to update location record.')
      }
      locationDbId = updated.id
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from('locations')
        .insert({
          workspace_id: workspaceId,
          name: profile.name,
          address: profile.address,
          phone: profile.phone,
          google_place_id: profile.googlePlaceId,
          google_account_id: profile.googleAccountId,
          google_location_id: profile.googleLocationId,
          is_connected: true,
        })
        .select('id')
        .single()

      if (insertError || !inserted) {
        throw new Error(insertError?.message || 'Failed to save selected location.')
      }
      locationDbId = inserted.id
    }

    // 4. Update google_integrations with selected account ID and timestamp
    await supabase
      .from('google_integrations')
      .update({
        account_id: profile.googleAccountId,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)

    // 5. Sync reviews ONLY for this selected profile
    let reviewsCount = 0
    try {
      const { accessToken } = await getValidGoogleAccessToken(supabase, workspaceId)
      const reviewsResult = await fetchGoogleReviews(
        accessToken,
        profile.googleAccountId,
        profile.googleLocationId
      )

      if (reviewsResult.supported && reviewsResult.reviews.length > 0) {
        for (const rev of reviewsResult.reviews) {
          const sentiment: 'positive' | 'neutral' | 'negative' =
            rev.rating >= 4 ? 'positive' : rev.rating === 3 ? 'neutral' : 'negative'
          const status: 'unanswered' | 'answered' = rev.reply ? 'answered' : 'unanswered'

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

          reviewsCount++

          // Sync replies
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
            // Unanswered review: auto-generate draft / process per policy
            try {
              await autoProcessSingleReview(supabase, {
                reviewId: reviewDbId,
                workspaceId,
                userId: user?.id || null,
              })
            } catch (autoErr) {
              console.warn(`Auto-reply skipped for review ${reviewDbId}:`, autoErr)
            }
          }
        }
      }
    } catch (syncErr) {
      console.warn('Initial review sync on profile selection completed with notice:', syncErr)
    }

    // 6. Revalidate all workspace dashboard pages
    revalidatePath('/dashboard/locations')
    revalidatePath('/dashboard/reviews')
    revalidatePath('/dashboard')

    return {
      success: true,
      locationId: locationDbId,
      name: profile.name,
      reviewsSynced: reviewsCount,
      message: `Successfully connected "${profile.name}".`,
    }
  } catch (err: unknown) {
    if (err instanceof GoogleApiError) {
      return { success: false, error: err.message }
    }
    const msg = err instanceof Error ? err.message : 'Failed to connect selected business profile.'
    return { success: false, error: msg }
  }
}

/**
 * 3. Explicitly disconnect the active Google Business Profile for this workspace.
 * Sets is_connected = false for the workspace locations. Does NOT switch profiles automatically.
 */
export async function disconnectGoogleProfileAction(
  workspaceId: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  if (!workspaceId) {
    return { success: false, error: 'Workspace ID is required.' }
  }

  try {
    const supabase = await createClient()

    const membershipCheck = await verifyWorkspaceMembership(supabase, workspaceId, [
      'owner',
      'admin',
    ])
    if (!membershipCheck.isMember) {
      return {
        success: false,
        error: membershipCheck.error || 'Unauthorized to disconnect integrations.',
      }
    }

    // Disconnect active locations
    await supabase
      .from('locations')
      .update({
        is_connected: false,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)

    revalidatePath('/dashboard/locations')
    revalidatePath('/dashboard/reviews')
    revalidatePath('/dashboard')

    return {
      success: true,
      message: 'Business profile successfully disconnected.',
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to disconnect profile.'
    return { success: false, error: msg }
  }
}

/**
 * 4. Sync reviews and details ONLY for the currently active, connected business profile.
 * Does NOT import, activate, or process other Google Business Profiles under the same Google account.
 */
export async function syncActiveLocationAction(
  workspaceId: string
): Promise<SyncLocationsResult> {
  if (!workspaceId) {
    return {
      success: false,
      locationsCount: 0,
      reviewsCount: 0,
      message: '',
      error: 'Workspace ID is required.',
    }
  }

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    // Verify authorization
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
        error: membershipCheck.error || 'Unauthorized workspace access.',
      }
    }

    // Find the single active connected location
    const { data: activeLoc, error: locError } = await supabase
      .from('locations')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('is_connected', true)
      .maybeSingle()

    if (locError || !activeLoc) {
      return {
        success: false,
        locationsCount: 0,
        reviewsCount: 0,
        message: '',
        error:
          'No active business profile is connected for this workspace. Please select and connect a business profile first.',
      }
    }

    if (!activeLoc.google_location_id || !activeLoc.google_account_id) {
      return {
        success: false,
        locationsCount: 0,
        reviewsCount: 0,
        message: '',
        error:
          'Connected business profile has invalid Google mapping. Please reconnect or reselect your profile.',
      }
    }

    // Get valid access token
    const { accessToken } = await getValidGoogleAccessToken(supabase, workspaceId)

    // Sync reviews ONLY for this active location
    const reviewsResult = await fetchGoogleReviews(
      accessToken,
      activeLoc.google_account_id,
      activeLoc.google_location_id
    )

    let totalReviewsSynced = 0

    if (reviewsResult.supported && reviewsResult.reviews.length > 0) {
      for (const rev of reviewsResult.reviews) {
        const sentiment: 'positive' | 'neutral' | 'negative' =
          rev.rating >= 4 ? 'positive' : rev.rating === 3 ? 'neutral' : 'negative'
        const status: 'unanswered' | 'answered' = rev.reply ? 'answered' : 'unanswered'

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
              location_id: activeLoc.id,
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

          reviewDbId = insertedRev?.id || null
        }

        totalReviewsSynced++

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
          try {
            await autoProcessSingleReview(supabase, {
              reviewId: reviewDbId,
              workspaceId,
              userId: user?.id || null,
            })
          } catch (autoErr) {
            console.warn(`Auto-reply skipped for review ${reviewDbId}:`, autoErr)
          }
        }
      }
    }

    // Update location and integration timestamp
    await supabase
      .from('locations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', activeLoc.id)

    await supabase
      .from('google_integrations')
      .update({ updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)

    revalidatePath('/dashboard/locations')
    revalidatePath('/dashboard/reviews')
    revalidatePath('/dashboard')

    return {
      success: true,
      locationsCount: 1,
      reviewsCount: totalReviewsSynced,
      message: `Successfully synchronized reviews for "${activeLoc.name}".`,
      reviewsMessage: reviewsResult.message,
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
    const msg = err instanceof Error ? err.message : 'Unexpected error during synchronization.'
    return {
      success: false,
      locationsCount: 0,
      reviewsCount: 0,
      message: '',
      error: msg,
    }
  }
}

/**
 * Backward compatibility alias: syncGoogleLocationsAction delegates to syncActiveLocationAction.
 */
export async function syncGoogleLocationsAction(
  workspaceId: string
): Promise<SyncLocationsResult> {
  return syncActiveLocationAction(workspaceId)
}
