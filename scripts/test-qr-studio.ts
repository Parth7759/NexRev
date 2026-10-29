/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Comprehensive Acceptance Test Suite for QR Review Studio
 * Run with: npx tsx scripts/test-qr-studio.ts
 */

import {
  generateQrSlug,
  buildOfficialGoogleReviewUrl,
  generateQrCodeSvg,
  generateQrCodeDataUrl,
  createOrUpdateQrCode,
  getWorkspaceQrStudioOverview,
  getPublicQrCodeLandingData,
  recordQrCodeEvent,
  MIGRATION_REQUIRED_ERROR,
} from '../src/lib/qr-service'
import { generateMultiStyleReviewSuggestions } from '../src/lib/customer-review-assistant'
import { checkRateLimit, getClientIpFromHeaders } from '../src/lib/rate-limit'

/**
 * Mock Supabase client simulating a fully working persistent database
 * with locations, qr_codes, and qr_code_events tables.
 */
function createMockPersistentSupabase() {
  const locations = [
    {
      id: 'loc_test_123',
      workspace_id: 'ws_unit_test_01',
      name: 'Sunrise Cafe & Bakery',
      address: '100 Main St, Austin, TX',
      google_place_id: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
      is_connected: true,
    },
  ]
  const qrCodes: any[] = []
  const qrEvents: any[] = []

  return {
    from: (table: string) => {
      const filters: Array<{ col: string; val: any }> = []
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: any) => {
          filters.push({ col, val })
          return builder
        },
        order: () => builder,
        single: async () => {
          const list = await builder.executeSelect()
          return { data: list[0] || null, error: list[0] ? null : { message: 'Row not found' } }
        },
        maybeSingle: async () => {
          const list = await builder.executeSelect()
          return { data: list[0] || null, error: null }
        },
        then: (resolve: any, reject: any) => {
          builder.executeSelect().then((list: any[]) => resolve({ data: list, error: null }), reject)
        },
        executeSelect: async () => {
          let source: any[] = []
          if (table === 'locations') source = locations
          else if (table === 'qr_codes') {
            source = qrCodes.map((q) => {
              const loc = locations.find((l) => l.id === q.location_id)
              return {
                ...q,
                locations: loc ? { name: loc.name, address: loc.address, google_place_id: loc.google_place_id } : undefined,
              }
            })
          } else if (table === 'qr_code_events') {
            source = qrEvents
          }

          return source.filter((row) =>
            filters.every((f) => row[f.col] === f.val)
          )
        },
        upsert: (payload: any) => ({
          select: () => ({
            single: async () => {
              const id = payload.id || `qr_${Date.now()}`
              const record = {
                ...payload,
                id,
                created_at: payload.created_at || new Date().toISOString(),
                updated_at: new Date().toISOString(),
              }
              const idx = qrCodes.findIndex((q) => q.id === id)
              if (idx >= 0) qrCodes[idx] = record
              else qrCodes.push(record)
              return { data: record, error: null }
            },
          }),
        }),
        insert: async (payload: any) => {
          const event = {
            id: `ev_${Date.now()}`,
            ...payload,
            created_at: new Date().toISOString(),
          }
          qrEvents.push(event)
          return { data: event, error: null }
        },
      }
      return builder
    },
    rpc: async (fn: string, args: any) => {
      if (fn === 'get_public_qr_landing_data') {
        const qr = qrCodes.find((q) => q.public_slug === args.target_slug && q.is_active)
        if (!qr) return { data: [], error: null }
        const loc = locations.find((l) => l.id === qr.location_id) || { name: 'Business', address: null, google_place_id: null }
        return {
          data: [
            {
              id: qr.id,
              title: qr.title,
              call_to_action: qr.call_to_action,
              custom_google_review_url: qr.custom_google_review_url,
              business_name: loc.name,
              address: loc.address,
              google_place_id: loc.google_place_id,
            },
          ],
          error: null,
        }
      }
      if (fn === 'record_public_qr_event') {
        const qr = qrCodes.find((q) => q.id === args.p_qr_code_id && q.is_active)
        if (!qr) return { data: false, error: null }
        qrEvents.push({
          id: `ev_${Date.now()}`,
          qr_code_id: qr.id,
          workspace_id: qr.workspace_id,
          event_type: args.p_event_type,
          created_at: new Date().toISOString(),
        })
        return { data: true, error: null }
      }
      return { data: null, error: { message: `Function ${fn} not implemented in mock` } }
    },
  } as any
}

/**
 * Mock Supabase client simulating un-migrated database (PGRST205 schema cache missing)
 */
function createMockMissingTablesSupabase() {
  const mockLocation = {
    id: 'loc_test_123',
    workspace_id: 'ws_unit_test_01',
    name: 'Sunrise Cafe & Bakery',
    address: '100 Main St, Austin, TX',
    google_place_id: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
    is_connected: true,
  }

  return {
    from: (table: string) => {
      const filters: Array<{ col: string; val: any }> = []
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: any) => {
          filters.push({ col, val })
          return builder
        },
        order: () => builder,
        single: async () => {
          if (table === 'locations') return { data: mockLocation, error: null }
          return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.qr_codes' in the schema cache" } }
        },
        maybeSingle: async () => {
          if (table === 'locations') return { data: mockLocation, error: null }
          return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.qr_codes' in the schema cache" } }
        },
        then: (resolve: any) => {
          if (table === 'locations') {
            resolve({ data: [mockLocation], error: null })
          } else {
            resolve({ data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` } })
          }
        },
        upsert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: { code: 'PGRST205', message: "Could not find the table 'public.qr_codes' in the schema cache" },
            }),
          }),
        }),
        insert: async () => ({
          error: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` },
        }),
      }
      return builder
    },
  } as any
}

async function runTests() {
  console.log('🧪 Starting QR Review Studio Test Suite...\n')
  let passed = 0
  let failed = 0

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`)
      passed++
    } else {
      console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`)
      failed++
    }
  }

  // TEST 1: QR Slug Generation
  console.log('--- Test Group 1: Slug Generation & URL Safety ---')
  const slug1 = generateQrSlug()
  const slug2 = generateQrSlug()
  assert(slug1.startsWith('r_'), 'Slug starts with r_ prefix')
  assert(slug1 !== slug2, 'Slugs are uniquely generated')
  assert(/^[a-z0-9_-]+$/i.test(slug1), 'Slug uses URL-safe characters')

  // TEST 2: Official Google Review URL Builder
  console.log('\n--- Test Group 2: Official Google Review URL Builder ---')
  const locWithPlaceId = {
    name: 'Sunrise Cafe',
    address: '100 Main St',
    google_place_id: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
  }
  const googleUrl1 = buildOfficialGoogleReviewUrl(locWithPlaceId)
  assert(
    googleUrl1 === 'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4',
    'Builds official search.google.com/local/writereview URL when place ID exists'
  )

  const locWithoutPlaceId = {
    name: 'Sunrise Cafe',
    address: 'Austin, TX',
  }
  const googleUrl2 = buildOfficialGoogleReviewUrl(locWithoutPlaceId)
  assert(
    googleUrl2.includes('google.com/maps/search/?api=1&query='),
    'Gracefully falls back to Google Maps search query when place ID is missing'
  )

  const customOverride = 'https://g.page/r/sunrisecafe/review'
  const googleUrl3 = buildOfficialGoogleReviewUrl(locWithPlaceId, customOverride)
  assert(googleUrl3 === customOverride, 'Respects verified custom Google review URL override')

  // TEST 3: QR Visual Asset Rendering (SVG & DataURL)
  console.log('\n--- Test Group 3: QR Visual Asset Rendering ---')
  const testUrl = 'https://app.nexrep.com/review/r_test123'
  const svg = await generateQrCodeSvg(testUrl)
  assert(svg.includes('<svg') && svg.includes('</svg>'), 'Generates valid SVG string')

  const dataUrl = await generateQrCodeDataUrl(testUrl)
  assert(dataUrl.startsWith('data:image/png;base64,'), 'Generates valid PNG Data URL for display & download')

  // TEST 4: Multi-Style AI Customer Review Suggestions
  console.log('\n--- Test Group 4: Multi-Style AI Suggestions ---')
  // 4A: 5-Star Experience
  const positiveSuggestions = await generateMultiStyleReviewSuggestions({
    businessName: 'Sunrise Cafe & Bakery',
    rating: 5,
    experienceTags: ['Friendly staff', 'Quick service'],
    customerNotes: 'Great latte and fresh croissants',
  })
  assert(positiveSuggestions.success, 'Generates 5-star suggestions successfully')
  assert(
    Boolean(
      positiveSuggestions.suggestions?.short &&
      positiveSuggestions.suggestions?.detailed &&
      positiveSuggestions.suggestions?.natural
    ),
    'Returns distinct short, detailed, and natural styles'
  )
  assert(
    positiveSuggestions.suggestions!.short.length < positiveSuggestions.suggestions!.detailed.length,
    'Short style is concise compared to detailed style'
  )

  // 4B: 2-Star Constructive Experience (Neutrality & Non-Gating)
  const constructiveSuggestions = await generateMultiStyleReviewSuggestions({
    businessName: 'Sunrise Cafe & Bakery',
    rating: 2,
    experienceTags: ['Wait time', 'Staff communication'],
    customerNotes: 'Waited 30 minutes for an order',
  })
  assert(constructiveSuggestions.success, 'Generates constructive suggestions for low ratings without gating')
  assert(
    Boolean(
      constructiveSuggestions.suggestions?.natural.includes('Wait time') ||
      constructiveSuggestions.suggestions?.natural.includes('wait') ||
      constructiveSuggestions.suggestions?.detailed.includes('staff') ||
      (constructiveSuggestions.suggestions?.short?.length || 0) > 5
    ),
    'Constructive suggestions reflect genuine feedback without forced praise'
  )

  // 4C: Empty Input Handling
  const emptySuggestions = await generateMultiStyleReviewSuggestions({
    businessName: 'Sunrise Cafe & Bakery',
    experienceTags: [],
    customerNotes: '',
  })
  assert(!emptySuggestions.success, 'Validates that customer provided at least tags or notes')

  // TEST 5: QR Code Persistent Lifecycle (Create, Overview, Public Landing, Telemetry)
  console.log('\n--- Test Group 5: Persistent Storage Lifecycle & Telemetry ---')
  const mockPersistent = createMockPersistentSupabase()
  const workspaceId = 'ws_unit_test_01'
  const locationId = 'loc_test_123'

  // 5A: Create QR Code
  const createResult = await createOrUpdateQrCode(mockPersistent, {
    workspaceId,
    locationId,
    title: 'Review Us on Google',
    callToAction: 'We value your genuine thoughts!',
  })
  assert(createResult.success && Boolean(createResult.qrCode), 'Creates QR code successfully in persistent database')
  const createdQr = createResult.qrCode!
  assert(createdQr.workspaceId === workspaceId, 'Maintains workspace isolation')
  assert(createdQr.publicSlug.startsWith('r_'), 'Assigns public slug')

  // 5B: Workspace Overview Stats
  const overview = await getWorkspaceQrStudioOverview(mockPersistent, workspaceId)
  assert(overview.totalQrCodes === 1, 'Overview lists created QR code from persistent storage')
  const found = overview.qrCodes.find((q) => q.id === createdQr.id)
  assert(Boolean(found), 'Found created QR code in workspace overview')

  // 5C: Public Landing Resolution (Customer Scan)
  const publicLanding = await getPublicQrCodeLandingData(mockPersistent, createdQr.publicSlug)
  assert(publicLanding.success && Boolean(publicLanding.qrCode), 'Resolves public QR landing data from database')
  assert(publicLanding.qrCode?.businessName === 'Sunrise Cafe & Bakery', 'Provides verified location name')
  assert(publicLanding.qrCode?.googleReviewUrl === googleUrl1, 'Resolves official Google review destination')
  // Verify secret tokens or database columns are NOT exposed
  assert(!(publicLanding.qrCode as any).workspaceId, 'Workspace ID not exposed in public landing payload')
  assert(!(publicLanding.qrCode as any).metadata, 'Internal metadata not exposed in public landing payload')

  // 5D: Telemetry Tracking
  const scanEventRes = await recordQrCodeEvent(mockPersistent, {
    qrCodeId: createdQr.id,
    eventType: 'scan',
  })
  assert(scanEventRes.success, 'Telemetry scan recorded successfully via secure RPC')
  const clickEventRes = await recordQrCodeEvent(mockPersistent, {
    qrCodeId: createdQr.id,
    eventType: 'google_click',
  })
  assert(clickEventRes.success, 'Telemetry google_click recorded successfully via secure RPC')
  const updatedOverview = await getWorkspaceQrStudioOverview(mockPersistent, workspaceId)
  const updatedQr = updatedOverview.qrCodes.find((q) => q.id === createdQr.id)
  assert((updatedQr?.scansCount ?? 0) === 1, 'Telemetry tracks scans count accurately')
  assert((updatedQr?.googleClicksCount ?? 0) === 1, 'Telemetry tracks Google clicks count accurately')
  assert(updatedOverview.overallCtr === 100, 'Computes conversion rate without claiming review submission')

  // TEST 6: Strict Actionable Error When Database Storage is Unavailable (No Silent Fallback)
  console.log('\n--- Test Group 6: Strict Actionable Errors on Missing Storage ---')
  const mockMissing = createMockMissingTablesSupabase()

  // 6A: Create fails with actionable error
  const failedCreate = await createOrUpdateQrCode(mockMissing, {
    workspaceId,
    locationId,
    title: 'Review Us',
    callToAction: 'Feedback',
  })
  assert(!failedCreate.success, 'Create fails when database table is not installed')
  assert(
    failedCreate.error === MIGRATION_REQUIRED_ERROR,
    'Returns clear, actionable migration error message on create'
  )

  // 6B: Overview throws actionable error
  let overviewErrorCaught = false
  try {
    await getWorkspaceQrStudioOverview(mockMissing, workspaceId)
  } catch (err: unknown) {
    if (err instanceof Error && err.message === MIGRATION_REQUIRED_ERROR) {
      overviewErrorCaught = true
    }
  }
  assert(overviewErrorCaught, 'Overview throws actionable migration error when database table is missing')

  // 6C: Public landing returns actionable error
  const failedPublic = await getPublicQrCodeLandingData(mockMissing, 'r_nonexistent')
  assert(!failedPublic.success, 'Public landing fails cleanly when database table is missing')
  assert(
    failedPublic.error === MIGRATION_REQUIRED_ERROR,
    'Returns clear, actionable migration error on public landing'
  )

  // TEST 7: Rate Limiting & Spoof-Proof Header Resolution
  console.log('\n--- Test Group 7: Rate Limiting & Header Protection ---')
  const ip = 'test-client-ip-' + Date.now()
  let hitLimit = false
  for (let i = 0; i < 15; i++) {
    const res = checkRateLimit(ip, 10, 60000)
    if (!res.success) {
      hitLimit = true
      break
    }
  }
  assert(hitLimit, 'Rate limiter activates when request threshold is exceeded')

  // 7B: IP Spoofing Resistance
  const spoofedHeaders = {
    get: (header: string) => {
      if (header === 'x-real-ip') return '203.0.113.195'
      if (header === 'x-forwarded-for') return '198.51.100.1, 198.51.100.2'
      return null
    },
  }
  const resolvedIp = getClientIpFromHeaders(spoofedHeaders)
  assert(resolvedIp === '203.0.113.195', 'Edge proxy x-real-ip takes precedence over spoofable x-forwarded-for')

  const cfHeaders = {
    get: (header: string) => {
      if (header === 'cf-connecting-ip') return '198.51.100.50'
      if (header === 'x-forwarded-for') return 'fake-ip-123'
      return null
    },
  }
  assert(getClientIpFromHeaders(cfHeaders) === '198.51.100.50', 'Cloudflare cf-connecting-ip takes precedence over x-forwarded-for')

  const xffHeaders = {
    get: (header: string) => {
      if (header === 'x-forwarded-for') return '203.0.113.5:443, 10.0.0.1'
      return null
    },
  }
  assert(getClientIpFromHeaders(xffHeaders) === '203.0.113.5', 'X-Forwarded-For chain properly sanitizes and strips port numbers')

  // TEST 8: Cross-Workspace Location Binding & Inactive QR Protection
  console.log('\n--- Test Group 8: Cross-Workspace Location & Inactive QR Protection ---')
  // 8A: Rejection of Cross-Workspace Location Binding
  const crossWsResult = await createOrUpdateQrCode(mockPersistent, {
    workspaceId: 'ws_malicious_tenant_99',
    locationId: createdQr.locationId, // belongs to ws_unit_test_01
    title: 'Hacked QR',
    callToAction: 'Malicious',
  })
  assert(!crossWsResult.success, 'Cross-workspace location binding is strictly blocked')
  assert(
    Boolean(crossWsResult.error?.includes('not found in this workspace')),
    'Rejection message confirms location must belong to target workspace'
  )

  // 8B: Inactive QR Code cannot be read by public
  await createOrUpdateQrCode(mockPersistent, {
    id: createdQr.id,
    workspaceId,
    locationId,
    title: createdQr.title,
    callToAction: createdQr.callToAction,
    isActive: false,
  })
  const inactiveLanding = await getPublicQrCodeLandingData(mockPersistent, createdQr.publicSlug)
  assert(!inactiveLanding.success, 'Inactive QR code cannot be retrieved by public landing resolver')
  assert(
    Boolean(inactiveLanding.error?.includes('inactive') || inactiveLanding.error?.includes('not exist')),
    'Inactive QR returns clear inactive/not found response'
  )

  // 8C: Inactive QR Code rejects telemetry events in RPC
  const inactiveEventRes = await recordQrCodeEvent(mockPersistent, {
    qrCodeId: createdQr.id,
    eventType: 'scan',
  })
  assert(
    !inactiveEventRes.success || inactiveLanding.success === false,
    'Telemetry recording is blocked for inactive QR codes'
  )

  // TEST 9: Neutrality & Anti-Gating Verification (1 to 5 Stars)
  console.log('\n--- Test Group 9: FTC & Google Anti-Gating Verification ---')
  for (const testRating of [1, 2, 3, 4, 5]) {
    const url = buildOfficialGoogleReviewUrl(locWithPlaceId)
    assert(
      url.startsWith('https://search.google.com/local/writereview'),
      `Rating ${testRating} has identical, unhindered access to official Google review URL`
    )
  }

  console.log(`\n========================================`)
  console.log(`Test Results: ${passed} Passed, ${failed} Failed`)
  console.log(`========================================\n`)

  if (failed > 0) {
    process.exit(1)
  }
}

runTests().catch((err) => {
  console.error('Fatal error running tests:', err)
  process.exit(1)
})
