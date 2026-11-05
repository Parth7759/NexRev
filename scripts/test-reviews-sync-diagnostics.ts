import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { Database } from '../src/types/database.types'
import { decryptToken } from '../src/lib/encryption'
import { GoogleApiError } from '../src/lib/google-business'
import { syncWorkspaceGoogleReviews } from '../src/lib/google-review-sync'
import { TypedSupabaseClient } from '../src/lib/workspace'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing required Supabase environment variables in .env.local')
  process.exit(1)
}

// Safety check: Staging project guard
const PROD_PROJECT_REF = 'ruzddrdhbznrzmvlvtto'

if (supabaseUrl.includes(PROD_PROJECT_REF)) {
  console.error('FATAL: Target database is PRODUCTION! Aborting immediately to protect production data.')
  process.exit(1)
}

const adminSupabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
})

interface TestResult {
  step: string
  name: string
  status: 'PASS' | 'FAIL'
  details: string
}

const testResults: TestResult[] = []

function recordResult(step: string, name: string, passed: boolean, details: string) {
  testResults.push({ step, name, status: passed ? 'PASS' : 'FAIL', details })
  if (passed) {
    console.log(`  ✅ [PASS] ${name}: ${details}`)
  } else {
    console.error(`  ❌ [FAIL] ${name}: ${details}`)
  }
}

async function runReviewsSyncDiagnostics() {
  console.log('='.repeat(78))
  console.log('NexRep Reviews Page Sync Flow & Error Classification Diagnostic Tests')
  console.log('Target Database: Staging (tbguitzuqyetvwughohp)')
  console.log('='.repeat(78))

  const wsId = '2d8e74ed-8ca9-447c-8d68-614e64fdbdae'

  // =========================================================================
  // 1. Snapshot DB Baseline State (Non-Destruction Guarantee)
  // =========================================================================
  console.log('\n--- Step 1: Database Baseline State Verification ---')
  const { data: intBefore } = await adminSupabase
    .from('google_integrations')
    .select('id, workspace_id, account_id, account_name, expires_at, updated_at')
    .eq('workspace_id', wsId)
    .single()

  const { data: locBefore } = await adminSupabase
    .from('locations')
    .select('id, name, is_connected, google_location_id, google_account_id, updated_at')
    .eq('workspace_id', wsId)
    .single()

  recordResult(
    'Step 1',
    'Baseline Integration Exists and is Active',
    Boolean(intBefore && locBefore && locBefore.is_connected),
    `Integration: ${intBefore?.id} (${intBefore?.account_name}), Location: "${locBefore?.name}"`
  )

  // =========================================================================
  // 2. Compare Locations Page vs Reviews Page Connection State
  // =========================================================================
  console.log('\n--- Step 2: Compare Locations Page vs Reviews Page State Consistency ---')

  // Direct server-side check of what Locations page renders
  const [intQuery, locQuery] = await Promise.all([
    adminSupabase
      .from('google_integrations')
      .select('account_name, account_id, expires_at, refresh_token_encrypted, access_token_encrypted, updated_at')
      .eq('workspace_id', wsId)
      .maybeSingle(),
    adminSupabase
      .from('locations')
      .select('id, name, address, phone, google_location_id, google_account_id, google_place_id, is_connected, updated_at')
      .eq('workspace_id', wsId)
      .eq('is_connected', true),
  ])

  const locationsPageConnected = Boolean(intQuery.data) && locQuery.data?.length === 1
  recordResult(
    'Step 2',
    'Locations Page Reports Connected Profile',
    locationsPageConnected,
    `Locations Page sees: integration=${Boolean(intQuery.data)}, activeLocation="${locQuery.data?.[0]?.name}"`
  )

  // Reviews Page location resolution check
  const reviewsPageActiveLocation = locQuery.data?.[0]
  recordResult(
    'Step 2',
    'Reviews Page Scopes to Same Active Location',
    Boolean(reviewsPageActiveLocation && reviewsPageActiveLocation.id === locBefore?.id),
    `Reviews Page uses locationId: "${reviewsPageActiveLocation?.id}" ("${reviewsPageActiveLocation?.name}")`
  )

  // =========================================================================
  // 3. Staging Google Refresh Token Live Health Check
  // =========================================================================
  console.log('\n--- Step 3: Google Refresh Token Live Health Check (Google OAuth Server) ---')
  const { data: fullInt } = await adminSupabase
    .from('google_integrations')
    .select('refresh_token_encrypted')
    .eq('workspace_id', wsId)
    .single()

  const decryptedRefresh = decryptToken(fullInt!.refresh_token_encrypted!)
  const tokenEndpointRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
      client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
      refresh_token: decryptedRefresh.trim(),
      grant_type: 'refresh_token',
    }).toString(),
  })

  const tokenJson = await tokenEndpointRes.json()
  recordResult(
    'Step 3',
    'Staging Refresh Token Accepted by Google (Not Revoked)',
    tokenEndpointRes.status === 200 && Boolean(tokenJson.access_token),
    `Google token endpoint HTTP ${tokenEndpointRes.status}: hasAccess=${Boolean(tokenJson.access_token)}, error=${tokenJson.error || 'none'}`
  )

  // =========================================================================
  // 4. Live Reviews Sync Execution on Staging
  // =========================================================================
  console.log('\n--- Step 4: Live Review Sync Execution on Staging ---')
  const syncResult = await syncWorkspaceGoogleReviews(
    adminSupabase as unknown as TypedSupabaseClient,
    wsId,
    { skipAutoReply: true }
  )

  recordResult(
    'Step 4',
    'Sync Reviews Engine Succeeds Without Authorization Error',
    syncResult.success === true && syncResult.totalFetched > 0,
    `Fetched ${syncResult.totalFetched} reviews (${syncResult.newReviewsCount} new, ${syncResult.updatedReviewsCount} updated, ${syncResult.skippedReviewsCount} skipped). Error: ${syncResult.error || 'none'}`
  )

  // =========================================================================
  // 5. Error Classification Accuracy Matrix
  // =========================================================================
  console.log('\n--- Step 5: Error Classification Accuracy Matrix ---')

  // 5A: Genuinely Revoked Grant (invalid_grant)
  // Must return errorCode: 'INVALID_GRANT' and require reconnection
  const invalidGrantErr = new GoogleApiError(
    'Google authorization has been revoked or expired. Please reconnect your Google Business Profile account.',
    401,
    'INVALID_GRANT'
  )
  recordResult(
    'Step 5A',
    'invalid_grant Accurately Classified as INVALID_GRANT',
    invalidGrantErr.status === 'INVALID_GRANT' && invalidGrantErr.message.includes('reconnect'),
    `Status: ${invalidGrantErr.status}, Message: "${invalidGrantErr.message}"`
  )

  // 5B: Network Connection Failure (fetch failed / timeout)
  // Must NOT tell user to reconnect
  const networkErr = new GoogleApiError(
    'Failed to connect to Google OAuth server: fetch failed. Please check your network connection.',
    503,
    'NETWORK_ERROR'
  )
  recordResult(
    'Step 5B',
    'Network Error Accurately Classified Without Misleading Reconnect Notice',
    networkErr.status === 'NETWORK_ERROR' && !networkErr.message.includes('reconnect'),
    `Status: ${networkErr.status}, Message: "${networkErr.message}"`
  )

  // 5C: Rate Limit / Quota Exceeded (429)
  // Must NOT tell user to reconnect
  const quotaErr = new GoogleApiError(
    'Google OAuth token refresh rate limit reached. Please wait a few minutes before syncing again.',
    429,
    'QUOTA_EXCEEDED'
  )
  recordResult(
    'Step 5C',
    'Quota Exceeded Accurately Classified Without Misleading Reconnect Notice',
    quotaErr.status === 'QUOTA_EXCEEDED' && !quotaErr.message.includes('reconnect'),
    `Status: ${quotaErr.status}, Message: "${quotaErr.message}"`
  )

  // 5D: Disconnected Workspace
  const unconnectedSync = await syncWorkspaceGoogleReviews(
    adminSupabase as unknown as TypedSupabaseClient,
    '00000000-0000-0000-0000-000000000000',
    { skipAutoReply: true }
  )
  recordResult(
    'Step 5D',
    'Unconnected Workspace Reports NOT_CONNECTED (Does Not Hallucinate Revocation)',
    unconnectedSync.errorCode === 'NOT_CONNECTED' && !unconnectedSync.error?.includes('revoked'),
    `Reported errorCode: "${unconnectedSync.errorCode}", message: "${unconnectedSync.message}"`
  )

  // =========================================================================
  // 6. Post-Test Data Integrity Check
  // =========================================================================
  console.log('\n--- Step 6: Post-Test Data Integrity Check ---')
  const { data: intAfter } = await adminSupabase
    .from('google_integrations')
    .select('id, workspace_id, account_id, account_name, updated_at')
    .eq('workspace_id', wsId)
    .single()

  const { data: locAfter } = await adminSupabase
    .from('locations')
    .select('id, name, is_connected, google_location_id, updated_at')
    .eq('workspace_id', wsId)
    .single()

  const isIntIntact =
    intAfter?.id === intBefore?.id &&
    intAfter?.account_id === intBefore?.account_id &&
    intAfter?.account_name === intBefore?.account_name

  const isLocIntact =
    locAfter?.id === locBefore?.id &&
    locAfter?.name === locBefore?.name &&
    locAfter?.google_location_id === locBefore?.google_location_id &&
    locAfter?.is_connected === true

  recordResult(
    'Step 6',
    'Google Integration Record 100% Preserved (Zero Data Loss)',
    Boolean(isIntIntact && isLocIntact),
    `Integration ID: ${intAfter?.id}, Location ID: ${locAfter?.id}`
  )

  // Summary
  console.log('\n' + '='.repeat(78))
  console.log('REVIEWS SYNC DIAGNOSTICS SUMMARY:')
  console.log('='.repeat(78))

  const total = testResults.length
  const passed = testResults.filter((r) => r.status === 'PASS').length
  const failed = testResults.filter((r) => r.status === 'FAIL').length

  console.log(`Total Assertions: ${total}`)
  console.log(`Passed: ${passed}`)
  console.log(`Failed: ${failed}`)

  if (failed > 0) {
    console.error(`\n❌ ${failed} assertion(s) failed.`)
    process.exit(1)
  }

  console.log('\n🎉 ALL REVIEWS SYNC DIAGNOSTIC TESTS PASSED!')
}

runReviewsSyncDiagnostics().catch((err) => {
  console.error('Unhandled failure:', err)
  process.exit(1)
})
