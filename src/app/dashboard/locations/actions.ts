'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { verifyWorkspaceMembership } from '@/lib/workspace'
import {
  getValidGoogleAccessToken,
  fetchGoogleAccounts,
  fetchGoogleLocations,
  GoogleApiError,
} from '@/lib/google-business'
import { syncWorkspaceGoogleReviews } from '@/lib/google-review-sync'
import {
  ensureGoogleAccountNotificationsRegistered,
  confirmGoogleNotificationTopicOverwrite,
  normalizeGoogleAccountId,
  normalizeGoogleAccountIdBare,
  normalizeGoogleLocationIdBare,
  normalizeGoogleLocationResource,
  NotificationRegistrationOutcome,
  NotificationRegistrationStatus,
  sanitizeGoogleDiagnosticError,
} from '@/lib/google-notification-registration'

export interface NotificationRegistrationView {
  status: NotificationRegistrationStatus
  googleAccountId: string
  pubsubTopic: string | null
  existingThirdPartyTopic: string | null
  notificationTypes: string[]
  attempts: number
  maxAttempts: number
  nextRetryAt: string | null
  registeredAt: string | null
  lastVerifiedAt: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
}

export interface LocationPageRecord {
  id: string
  name: string
  address: string | null
  phone: string | null
  google_location_id: string | null
  google_account_id: string | null
  google_place_id: string | null
  is_connected: boolean
  updated_at?: string | null
}

export interface LocationPageDataResult {
  success: boolean
  workspaceId: string
  integration: {
    isConnected: boolean
    accountName: string | null
    accountId: string | null
    updatedAt: string | null
    isTokenExpired: boolean
    hasRefreshToken: boolean
  }
  activeLocation: LocationPageRecord | null
  connectedLocationsCount: number
  notificationRegistration: NotificationRegistrationView | null
  error?: string
}

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
  notificationRegistration?: NotificationRegistrationOutcome | null
  message?: string
  error?: string
}

export interface SyncLocationsResult {
  success: boolean
  locationsCount: number
  reviewsCount: number
  newReviewsCount?: number
  updatedReviewsCount?: number
  skippedReviewsCount?: number
  unansweredCount?: number
  negativeReviewsCount?: number
  lastSyncedAt?: string
  message: string
  reviewsMessage?: string
  error?: string
  errorCode?: string
}

/**
 * 0. Fetches Google integration status and connected location records securely on the server.
 * Replaces brittle client-side browser database queries with server-side authentication.
 * Pure database inspection — DOES NOT call external Google OAuth refresh endpoints to render the page.
 */
export async function getLocationPageDataAction(
  workspaceId: string
): Promise<LocationPageDataResult> {
  const emptyIntegration = {
    isConnected: false,
    accountName: null,
    accountId: null,
    updatedAt: null,
    isTokenExpired: false,
    hasRefreshToken: false,
  }

  if (!workspaceId) {
    return {
      success: false,
      workspaceId: '',
      integration: emptyIntegration,
      activeLocation: null,
      connectedLocationsCount: 0,
      notificationRegistration: null,
      error: 'Workspace ID is required.',
    }
  }

  try {
    const supabase = await createClient()

    // 1. Verify user authentication and membership
    const membershipCheck = await verifyWorkspaceMembership(supabase, workspaceId)
    if (!membershipCheck.isMember) {
      return {
        success: false,
        workspaceId,
        integration: emptyIntegration,
        activeLocation: null,
        connectedLocationsCount: 0,
        notificationRegistration: null,
        error: membershipCheck.error || 'You do not have access to this workspace.',
      }
    }

    // 2. Query google_integrations, locations, and account-scoped notification registrations in parallel
    const [integrationRes, locationsRes, notifRegsRes] = await Promise.all([
      supabase
        .from('google_integrations')
        .select('account_name, account_id, expires_at, refresh_token_encrypted, access_token_encrypted, updated_at')
        .eq('workspace_id', workspaceId)
        .maybeSingle(),
      supabase
        .from('locations')
        .select('id, name, address, phone, google_location_id, google_account_id, google_place_id, is_connected, updated_at')
        .eq('workspace_id', workspaceId)
        .eq('is_connected', true),
      supabase
        .from('google_notification_registrations')
        .select('google_account_id, pubsub_topic, notification_types, status, attempts, max_attempts, next_retry_at, registered_at, last_verified_at, last_error_code, last_error_message, metadata')
        .eq('workspace_id', workspaceId),
    ])

    if (integrationRes.error) {
      return {
        success: false,
        workspaceId,
        integration: emptyIntegration,
        activeLocation: null,
        connectedLocationsCount: 0,
        notificationRegistration: null,
        error: `Database error checking Google integration: ${integrationRes.error.message}`,
      }
    }

    if (locationsRes.error) {
      return {
        success: false,
        workspaceId,
        integration: emptyIntegration,
        activeLocation: null,
        connectedLocationsCount: 0,
        notificationRegistration: null,
        error: `Database error loading locations: ${locationsRes.error.message}`,
      }
    }

    const intData = integrationRes.data
    const isConnected = Boolean(intData)

    let isTokenExpired = false
    if (intData?.expires_at) {
      isTokenExpired = new Date(intData.expires_at).getTime() <= Date.now()
    }

    const connectedLocations = (locationsRes.data || []) as LocationPageRecord[]
    const activeLocation = connectedLocations.length === 1 ? connectedLocations[0] : null

    let notificationRegistration: NotificationRegistrationView | null = null
    if (activeLocation?.google_account_id && Array.isArray(notifRegsRes.data)) {
      const targetNormAcc = normalizeGoogleAccountId(activeLocation.google_account_id)
      const matchedReg = notifRegsRes.data.find(
        (r) => normalizeGoogleAccountId(r.google_account_id) === targetNormAcc
      )
      if (matchedReg) {
        const metaObj =
          matchedReg.metadata &&
          typeof matchedReg.metadata === 'object' &&
          !Array.isArray(matchedReg.metadata)
            ? (matchedReg.metadata as Record<string, unknown>)
            : {}
        notificationRegistration = {
          status: matchedReg.status,
          googleAccountId: matchedReg.google_account_id,
          pubsubTopic: matchedReg.pubsub_topic,
          existingThirdPartyTopic:
            typeof metaObj.existingPubsubTopic === 'string'
              ? metaObj.existingPubsubTopic
              : matchedReg.status === 'topic_conflict'
                ? matchedReg.pubsub_topic
                : null,
          notificationTypes: matchedReg.notification_types || [],
          attempts: matchedReg.attempts,
          maxAttempts: matchedReg.max_attempts,
          nextRetryAt: matchedReg.next_retry_at,
          registeredAt: matchedReg.registered_at,
          lastVerifiedAt: matchedReg.last_verified_at,
          lastErrorCode: matchedReg.last_error_code,
          lastErrorMessage: matchedReg.last_error_message,
        }
      }
    }

    return {
      success: true,
      workspaceId,
      integration: {
        isConnected,
        accountName: intData?.account_name || null,
        accountId: intData?.account_id || null,
        updatedAt: intData?.updated_at || null,
        isTokenExpired,
        hasRefreshToken: Boolean(intData?.refresh_token_encrypted),
      },
      activeLocation,
      connectedLocationsCount: connectedLocations.length,
      notificationRegistration,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch location data.'
    return {
      success: false,
      workspaceId,
      integration: emptyIntegration,
      activeLocation: null,
      connectedLocationsCount: 0,
      notificationRegistration: null,
      error: msg,
    }
  }
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
  if (!workspaceId || !profile || !profile.googleLocationId || !profile.googleAccountId) {
    return {
      success: false,
      error: 'Workspace ID and valid Google Business Profile account/location data are required.',
    }
  }

  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return {
        success: false,
        error: 'You must be signed in to connect a business profile.',
      }
    }

    // 1. Verify workspace owner/admin role
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

    // 2. Verify live Google OAuth ownership of the selected (googleAccountId, googleLocationId)
    // Never trust client-supplied IDs and never permit cross-workspace location-existence probing.
    const requestedAccBare = normalizeGoogleAccountIdBare(profile.googleAccountId)
    const requestedLocBare = normalizeGoogleLocationIdBare(profile.googleLocationId)
    if (!requestedAccBare || !requestedLocBare) {
      return {
        success: false,
        error: 'Invalid Google Business Profile account or location identifier.',
      }
    }

    const { accessToken } = await getValidGoogleAccessToken(supabase, workspaceId)
    const liveAccounts = await fetchGoogleAccounts(accessToken)
    const matchedAccount = liveAccounts.find(
      (acc) => normalizeGoogleAccountIdBare(acc.name) === requestedAccBare
    )
    if (!matchedAccount) {
      return {
        success: false,
        error:
          'The selected Google Business Profile account could not be verified under your connected Google account.',
      }
    }

    const liveLocations = await fetchGoogleLocations(accessToken, matchedAccount.name)
    const verifiedProfile = liveLocations.find(
      (loc) => normalizeGoogleLocationIdBare(loc.googleLocationId) === requestedLocBare
    )
    if (!verifiedProfile) {
      return {
        success: false,
        error:
          'The selected Google Business Profile location could not be verified under your connected Google account.',
      }
    }

    const normalizedAccountId = normalizeGoogleAccountId(
      verifiedProfile.googleAccountId || matchedAccount.name
    )
    const normalizedLocationId = normalizeGoogleLocationResource(verifiedProfile.googleLocationId)

    // 3. Atomically claim and activate ONLY this location via service_role-only RPC
    // Enforces database-level cross-workspace exclusivity with privacy-safe conflict response.
    const adminSupabase = createAdminClient()
    const { data: claimData, error: claimErr } = await adminSupabase.rpc(
      'claim_and_activate_google_location',
      {
        p_actor_user_id: user.id,
        p_workspace_id: workspaceId,
        p_google_account_id: normalizedAccountId,
        p_google_location_id: normalizedLocationId,
        p_name: verifiedProfile.name,
        p_address: verifiedProfile.address,
        p_phone: verifiedProfile.phone,
        p_google_place_id: verifiedProfile.googlePlaceId,
      }
    )

    if (claimErr || !claimData || typeof claimData !== 'object' || Array.isArray(claimData)) {
      throw new Error(claimErr?.message || 'Failed to activate selected business profile.')
    }

    const claimResult = claimData as Record<string, unknown>
    if (claimResult.unauthorized === true) {
      return {
        success: false,
        error: 'You do not have administrative permission to configure integrations for this workspace.',
      }
    }

    if (claimResult.conflict === true || claimResult.claimed !== true) {
      return {
        success: false,
        error:
          'This Google Business Profile location is already actively connected to another workspace. Disconnect it there first, then try again.',
      }
    }

    const locationDbId = String(claimResult.location_id || '')

    // 4. Non-blocking idempotent account-level Pub/Sub notification auto-registration
    // Failures persist diagnostics cleanly and NEVER break Google connection or location activation.
    let notificationRegistration: NotificationRegistrationOutcome | null = null
    try {
      notificationRegistration = await ensureGoogleAccountNotificationsRegistered(adminSupabase, {
        workspaceId,
        googleAccountId: normalizedAccountId,
        source: 'auto_registration',
      })
    } catch (notifErr: unknown) {
      console.warn(
        'Non-blocking GBP Pub/Sub auto-registration notice:',
        sanitizeGoogleDiagnosticError(
          notifErr instanceof Error ? notifErr.message : 'Notification registration error'
        )
      )
    }

    // 5. Sync historical reviews strictly for this newly selected profile (never inline auto-reply)
    let reviewsCount = 0
    try {
      const syncRes = await syncWorkspaceGoogleReviews(supabase, workspaceId, {
        userId: user.id,
        skipAutoReply: true,
      })
      reviewsCount = syncRes.totalFetched
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
      name: verifiedProfile.name,
      reviewsSynced: reviewsCount,
      notificationRegistration,
      message: `Successfully connected "${verifiedProfile.name}".`,
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
 * 2b. Retries or reconciles Google Business Profile Pub/Sub notification registration
 * for the workspace's active connected Google account without requiring OAuth reconnect.
 */
export async function retryGoogleNotificationRegistrationAction(
  workspaceId: string
): Promise<{
  success: boolean
  result?: NotificationRegistrationOutcome
  message?: string
  error?: string
}> {
  if (!workspaceId) {
    return { success: false, error: 'Workspace ID is required.' }
  }

  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: 'You must be signed in to manage notifications.' }
    }

    const membershipCheck = await verifyWorkspaceMembership(supabase, workspaceId, [
      'owner',
      'admin',
    ])
    if (!membershipCheck.isMember) {
      return {
        success: false,
        error:
          membershipCheck.error ||
          'Only workspace owners and administrators can manage real-time notifications.',
      }
    }

    const { data: activeLocs } = await supabase
      .from('locations')
      .select('id, google_account_id')
      .eq('workspace_id', workspaceId)
      .eq('is_connected', true)

    if (!activeLocs || activeLocs.length !== 1 || !activeLocs[0].google_account_id) {
      return {
        success: false,
        error: 'An active connected Google Business Profile location is required first.',
      }
    }

    const adminSupabase = createAdminClient()
    const result = await ensureGoogleAccountNotificationsRegistered(adminSupabase, {
      workspaceId,
      googleAccountId: activeLocs[0].google_account_id,
      source: 'manual_retry',
      forceVerify: true,
      resetAttempts: true,
    })

    revalidatePath('/dashboard/locations')
    revalidatePath('/dashboard/reviews')

    if (!result.success) {
      return {
        success: false,
        result,
        error: result.errorMessage || 'Real-time notification registration did not complete.',
      }
    }

    return {
      success: true,
      result,
      message: 'Real-time Google Business Profile notifications are active and verified.',
    }
  } catch (err: unknown) {
    return {
      success: false,
      error: sanitizeGoogleDiagnosticError(
        err instanceof Error ? err.message : 'Failed to retry notification registration.'
      ),
    }
  }
}

/**
 * 2c. Explicit owner/admin confirmation to replace an existing third-party Pub/Sub topic
 * on the workspace's active GBP account. Verifies expectedCurrentTopic against a fresh Google GET
 * under a fenced account lock before issuing minimal PATCH.
 */
export async function confirmGoogleNotificationTopicOverwriteAction(
  workspaceId: string,
  expectedCurrentTopic: string
): Promise<{
  success: boolean
  result?: NotificationRegistrationOutcome
  message?: string
  error?: string
}> {
  if (!workspaceId || !expectedCurrentTopic || !expectedCurrentTopic.trim()) {
    return {
      success: false,
      error: 'Workspace ID and expected existing topic are required to confirm replacement.',
    }
  }

  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: 'You must be signed in to confirm topic replacement.' }
    }

    const membershipCheck = await verifyWorkspaceMembership(supabase, workspaceId, [
      'owner',
      'admin',
    ])
    if (!membershipCheck.isMember) {
      return {
        success: false,
        error:
          membershipCheck.error ||
          'Only workspace owners and administrators can confirm Pub/Sub topic replacement.',
      }
    }

    const { data: activeLocs } = await supabase
      .from('locations')
      .select('id, google_account_id')
      .eq('workspace_id', workspaceId)
      .eq('is_connected', true)

    if (!activeLocs || activeLocs.length !== 1 || !activeLocs[0].google_account_id) {
      return {
        success: false,
        error: 'An active connected Google Business Profile location is required.',
      }
    }

    const adminSupabase = createAdminClient()
    const result = await confirmGoogleNotificationTopicOverwrite(adminSupabase, {
      workspaceId,
      googleAccountId: activeLocs[0].google_account_id,
      actorUserId: user.id,
      expectedCurrentTopic: expectedCurrentTopic.trim(),
    })

    revalidatePath('/dashboard/locations')
    revalidatePath('/dashboard/reviews')

    if (!result.success) {
      return {
        success: false,
        result,
        error: result.errorMessage || 'Could not replace existing Pub/Sub topic.',
      }
    }

    return {
      success: true,
      result,
      message: 'Google Business Profile Pub/Sub topic updated and verified.',
    }
  } catch (err: unknown) {
    return {
      success: false,
      error: sanitizeGoogleDiagnosticError(
        err instanceof Error ? err.message : 'Failed to replace Pub/Sub topic.'
      ),
    }
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
  workspaceId: string,
  options: { skipAutoReply?: boolean } = { skipAutoReply: true }
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

    // Delegate review synchronization to the centralized google-review-sync engine
    // Never auto-publish/generate AI replies during diagnostic/manual sync by default
    const syncRes = await syncWorkspaceGoogleReviews(supabase, workspaceId, {
      userId: user?.id || null,
      skipAutoReply: options.skipAutoReply ?? true,
    })

    revalidatePath('/dashboard/locations')
    revalidatePath('/dashboard/reviews')
    revalidatePath('/dashboard')

    if (!syncRes.success) {
      return {
        success: false,
        locationsCount: 0,
        reviewsCount: 0,
        message: '',
        error: syncRes.error || syncRes.message,
        errorCode: syncRes.errorCode,
      }
    }

    return {
      success: true,
      locationsCount: 1,
      reviewsCount: syncRes.totalFetched,
      newReviewsCount: syncRes.newReviewsCount,
      updatedReviewsCount: syncRes.updatedReviewsCount,
      skippedReviewsCount: syncRes.skippedReviewsCount,
      unansweredCount: syncRes.unansweredCount,
      negativeReviewsCount: syncRes.negativeReviewsCount,
      lastSyncedAt: syncRes.lastSyncedAt,
      message: syncRes.negativeReviewsCount > 0
        ? `Successfully synced ${syncRes.totalFetched} reviews (${syncRes.newReviewsCount} new, ${syncRes.updatedReviewsCount} updated, ${syncRes.skippedReviewsCount} unchanged, ${syncRes.negativeReviewsCount} negative review${syncRes.negativeReviewsCount === 1 ? '' : 's'} flagged for attention in in-app alerts).`
        : `Successfully synced ${syncRes.totalFetched} reviews (${syncRes.newReviewsCount} new, ${syncRes.updatedReviewsCount} updated, ${syncRes.skippedReviewsCount} unchanged).`,
      reviewsMessage: syncRes.message,
    }
  } catch (err: unknown) {
    if (err instanceof GoogleApiError) {
      return {
        success: false,
        locationsCount: 0,
        reviewsCount: 0,
        message: '',
        error: err.message,
        errorCode: err.status,
      }
    }
    const msg = err instanceof Error ? err.message : 'Unexpected error during synchronization.'
    return {
      success: false,
      locationsCount: 0,
      reviewsCount: 0,
      message: '',
      error: msg,
      errorCode: 'SERVER_ERROR',
    }
  }
}

/**
 * Backward compatibility alias: syncGoogleLocationsAction delegates to syncActiveLocationAction.
 */
export async function syncGoogleLocationsAction(
  workspaceId: string,
  options: { skipAutoReply?: boolean } = { skipAutoReply: true }
): Promise<SyncLocationsResult> {
  return syncActiveLocationAction(workspaceId, options)
}
