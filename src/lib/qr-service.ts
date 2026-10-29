/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'crypto'
import QRCode from 'qrcode'
import { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'

export type TypedSupabaseClient = SupabaseClient<Database>

export const MIGRATION_REQUIRED_ERROR =
  "Database tables for QR Review Studio are not yet installed. Please apply migration 20261027000000_create_qr_review_studio.sql to enable persistent QR code storage."

export interface QrCodeRecord {
  id: string
  workspaceId: string
  locationId: string
  publicSlug: string
  title: string
  callToAction: string
  customGoogleReviewUrl: string | null
  isActive: boolean
  locationName: string
  locationAddress: string | null
  googlePlaceId: string | null
  googleReviewUrl: string
  createdAt: string
  updatedAt: string
  scansCount: number
  googleClicksCount: number
  suggestionsCount: number
}

export interface QrStudioOverview {
  totalQrCodes: number
  totalScans: number
  totalGoogleClicks: number
  totalSuggestions: number
  overallCtr: number // e.g. 42.5%
  qrCodes: QrCodeRecord[]
}

export interface SaveQrCodeInput {
  id?: string
  workspaceId: string
  locationId: string
  title: string
  callToAction: string
  customGoogleReviewUrl?: string | null
  isActive?: boolean
}

/**
 * Checks if a Supabase error indicates that the table does not exist in schema cache yet.
 */
export function isTableMissingError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    Boolean(error.message?.includes('schema cache')) ||
    Boolean(error.message?.includes('does not exist'))
  )
}

/**
 * Generates an unguessable, URL-safe cryptographic slug for public QR access.
 */
export function generateQrSlug(): string {
  const randomPart = crypto.randomBytes(9).toString('base64url').toLowerCase()
  return `r_${randomPart}`
}

/**
 * Builds the canonical official Google review destination URL for a business location.
 * Uses official search.google.com/local/writereview?placeid= format if place ID is available.
 */
export function buildOfficialGoogleReviewUrl(
  location: {
    name: string
    address?: string | null
    google_place_id?: string | null
  },
  customUrl?: string | null
): string {
  const cleanCustom = customUrl?.trim()
  if (cleanCustom && cleanCustom.startsWith('https://')) {
    return cleanCustom
  }

  if (location.google_place_id && location.google_place_id.trim() !== '') {
    return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(
      location.google_place_id.trim()
    )}`
  }

  // Fallback to Google Maps Search intent URL
  const query = [location.name, location.address].filter(Boolean).join(' ')
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

/**
 * Generates an SVG string representation of the QR code.
 */
export async function generateQrCodeSvg(
  url: string,
  options?: {
    margin?: number
    darkColor?: string
    lightColor?: string
  }
): Promise<string> {
  return QRCode.toString(url, {
    type: 'svg',
    margin: options?.margin ?? 2,
    color: {
      dark: options?.darkColor ?? '#064e3b', // Deep emerald dark
      light: options?.lightColor ?? '#ffffff',
    },
  })
}

/**
 * Generates a high-res PNG Data URL for printing table tents and stickers.
 */
export async function generateQrCodeDataUrl(
  url: string,
  options?: {
    width?: number
    margin?: number
    darkColor?: string
    lightColor?: string
  }
): Promise<string> {
  return QRCode.toDataURL(url, {
    width: options?.width ?? 600,
    margin: options?.margin ?? 2,
    color: {
      dark: options?.darkColor ?? '#064e3b',
      light: options?.lightColor ?? '#ffffff',
    },
  })
}

/**
 * Fetches all QR codes and aggregated analytics for a workspace from persistent Supabase tables.
 * Throws an actionable error if persistent storage tables are not yet created.
 */
export async function getWorkspaceQrStudioOverview(
  supabase: TypedSupabaseClient,
  workspaceId: string
): Promise<QrStudioOverview> {
  // 1. Fetch locations for this workspace
  const { data: locations, error: locError } = await supabase
    .from('locations')
    .select('id, name, address, google_place_id, is_connected')
    .eq('workspace_id', workspaceId)

  if (locError) {
    throw new Error(`Failed to load locations: ${locError.message}`)
  }

  const locationMap = new Map((locations || []).map((l) => [l.id, l]))

  // 2. Fetch from Supabase qr_codes table
  const anyClient = supabase as any
  const { data: dbQrCodes, error: qrError } = await anyClient
    .from('qr_codes')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  if (qrError) {
    if (isTableMissingError(qrError)) {
      throw new Error(MIGRATION_REQUIRED_ERROR)
    }
    throw new Error(`Database error loading QR codes: ${qrError.message}`)
  }

  // 3. Fetch aggregate telemetry events
  const { data: dbEvents, error: eventsError } = await anyClient
    .from('qr_code_events')
    .select('qr_code_id, event_type')
    .eq('workspace_id', workspaceId)

  if (eventsError && isTableMissingError(eventsError)) {
    throw new Error(MIGRATION_REQUIRED_ERROR)
  }

  const eventsByQr = new Map<string, { scans: number; clicks: number; suggestions: number }>()
  for (const ev of (dbEvents || []) as any[]) {
    const current = eventsByQr.get(ev.qr_code_id) || { scans: 0, clicks: 0, suggestions: 0 }
    if (ev.event_type === 'scan') current.scans++
    if (ev.event_type === 'google_click') current.clicks++
    if (ev.event_type === 'suggestion_generated') current.suggestions++
    eventsByQr.set(ev.qr_code_id, current)
  }

  const records: QrCodeRecord[] = ((dbQrCodes || []) as any[]).map((item) => {
    const loc = locationMap.get(item.location_id) || {
      name: 'Business Location',
      address: null,
      google_place_id: null,
    }
    const counts = eventsByQr.get(item.id) || { scans: 0, clicks: 0, suggestions: 0 }
    const googleUrl = buildOfficialGoogleReviewUrl(loc, item.custom_google_review_url)

    return {
      id: item.id,
      workspaceId: item.workspace_id,
      locationId: item.location_id,
      publicSlug: item.public_slug,
      title: item.title || 'Review Us on Google',
      callToAction: item.call_to_action || 'Scan to share your feedback',
      customGoogleReviewUrl: item.custom_google_review_url,
      isActive: Boolean(item.is_active),
      locationName: loc.name,
      locationAddress: loc.address,
      googlePlaceId: loc.google_place_id,
      googleReviewUrl: googleUrl,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      scansCount: counts.scans,
      googleClicksCount: counts.clicks,
      suggestionsCount: counts.suggestions,
    }
  })

  return buildOverviewSummary(records)
}

function buildOverviewSummary(records: QrCodeRecord[]): QrStudioOverview {
  const totalScans = records.reduce((acc, r) => acc + r.scansCount, 0)
  const totalGoogleClicks = records.reduce((acc, r) => acc + r.googleClicksCount, 0)
  const totalSuggestions = records.reduce((acc, r) => acc + r.suggestionsCount, 0)
  const overallCtr = totalScans > 0 ? Math.round((totalGoogleClicks / totalScans) * 1000) / 10 : 0

  return {
    totalQrCodes: records.length,
    totalScans,
    totalGoogleClicks,
    totalSuggestions,
    overallCtr,
    qrCodes: records,
  }
}

/**
 * Creates or updates a QR code configuration for a business location in persistent storage.
 * Fails with an actionable error if persistent tables are not installed.
 */
export async function createOrUpdateQrCode(
  supabase: TypedSupabaseClient,
  input: SaveQrCodeInput
): Promise<{ success: boolean; qrCode?: QrCodeRecord; error?: string }> {
  if (!input.workspaceId || !input.locationId) {
    return { success: false, error: 'Workspace ID and Location ID are required.' }
  }

  const { data: loc, error: locError } = await supabase
    .from('locations')
    .select('id, name, address, google_place_id')
    .eq('id', input.locationId)
    .eq('workspace_id', input.workspaceId)
    .maybeSingle()

  if (locError) {
    return { success: false, error: `Location lookup failed: ${locError.message}` }
  }

  if (!loc) {
    return { success: false, error: 'Specified business location was not found in this workspace.' }
  }

  const slug = input.id ? undefined : generateQrSlug()
  const customUrl = input.customGoogleReviewUrl?.trim() || null

  const payload: any = {
    workspace_id: input.workspaceId,
    location_id: input.locationId,
    title: input.title.trim() || `Review ${loc.name} on Google`,
    call_to_action: input.callToAction.trim() || 'Scan to share your feedback',
    custom_google_review_url: customUrl,
    is_active: input.isActive ?? true,
    updated_at: new Date().toISOString(),
  }

  if (input.id) {
    payload.id = input.id
  } else {
    payload.public_slug = slug
  }

  const anyClient = supabase as any
  const { data, error } = await anyClient
    .from('qr_codes')
    .upsert(payload)
    .select('*')
    .single()

  if (error) {
    if (isTableMissingError(error)) {
      return {
        success: false,
        error: MIGRATION_REQUIRED_ERROR,
      }
    }
    return { success: false, error: error.message || 'Failed to save QR code.' }
  }

  if (!data) {
    return { success: false, error: 'No data returned from database.' }
  }

  const googleReviewUrl = buildOfficialGoogleReviewUrl(loc, data.custom_google_review_url)
  return {
    success: true,
    qrCode: {
      id: data.id,
      workspaceId: data.workspace_id,
      locationId: data.location_id,
      publicSlug: data.public_slug,
      title: data.title,
      callToAction: data.call_to_action,
      customGoogleReviewUrl: data.custom_google_review_url,
      isActive: data.is_active,
      locationName: loc.name,
      locationAddress: loc.address,
      googlePlaceId: loc.google_place_id,
      googleReviewUrl,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      scansCount: 0,
      googleClicksCount: 0,
      suggestionsCount: 0,
    },
  }
}

/**
 * Public resolver: retrieves QR code details and business information from persistent storage.
 */
export async function getPublicQrCodeLandingData(
  supabase: TypedSupabaseClient,
  slug: string
): Promise<{
  success: boolean
  qrCode?: {
    id: string
    title: string
    callToAction: string
    businessName: string
    address: string | null
    googleReviewUrl: string
    hasPlaceId: boolean
  }
  error?: string
}> {
  if (!slug || slug.trim() === '') {
    return { success: false, error: 'Invalid QR code.' }
  }

  const cleanSlug = slug.trim()
  const anyClient = supabase as any

  // 1. Attempt secure RPC query if available (returns minimal public columns, zero workspace metadata exposure)
  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc('get_public_qr_landing_data', {
      target_slug: cleanSlug,
    })

    if (!rpcError && Array.isArray(rpcData) && rpcData.length > 0) {
      const row = rpcData[0]
        const loc = {
          name: row.business_name,
          address: row.address,
          google_place_id: row.google_place_id,
        }
        const googleReviewUrl = buildOfficialGoogleReviewUrl(loc, row.custom_google_review_url)

        return {
          success: true,
          qrCode: {
            id: row.id,
            title: row.title,
            callToAction: row.call_to_action,
            businessName: row.business_name,
            address: row.address,
            googleReviewUrl,
            hasPlaceId: Boolean(row.google_place_id),
          },
        }
      }
    } catch {
    // Fall through to direct table query
  }

  // 2. Direct table query fallback
  const { data: qr, error } = await anyClient
    .from('qr_codes')
    .select('*, locations(name, address, google_place_id)')
    .eq('public_slug', cleanSlug)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    if (isTableMissingError(error)) {
      return {
        success: false,
        error: MIGRATION_REQUIRED_ERROR,
      }
    }
    return { success: false, error: error.message || 'Failed to retrieve QR code.' }
  }

  if (!qr) {
    return { success: false, error: 'This QR code is either inactive or does not exist.' }
  }

  const loc = qr.locations || { name: 'Business', address: null, google_place_id: null }
  const googleReviewUrl = buildOfficialGoogleReviewUrl(loc, qr.custom_google_review_url)

  return {
    success: true,
    qrCode: {
      id: qr.id,
      title: qr.title,
      callToAction: qr.call_to_action,
      businessName: loc.name,
      address: loc.address,
      googleReviewUrl,
      hasPlaceId: Boolean(loc.google_place_id),
    },
  }
}

/**
 * Records telemetry events (scans, continue-to-google clicks, suggestions generated) to persistent database.
 */
export async function recordQrCodeEvent(
  supabase: TypedSupabaseClient,
  params: {
    qrCodeId: string
    eventType: 'scan' | 'google_click' | 'suggestion_generated'
    metadata?: Record<string, any>
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const anyClient = supabase as any

    // 1. Attempt secure RPC recording if available (validates active status and attaches workspace_id internally)
    try {
      const { data: rpcSuccess, error: rpcErr } = await supabase.rpc('record_public_qr_event', {
        p_qr_code_id: params.qrCodeId,
        p_event_type: params.eventType,
      })
      if (!rpcErr && rpcSuccess === true) {
        return { success: true }
      }
    } catch {
      // Fall through to direct table insert
    }

    // 2. Direct table insert fallback
    // Lookup workspaceId for qrCodeId
    const { data: qr, error: qrErr } = await anyClient
      .from('qr_codes')
      .select('workspace_id')
      .eq('id', params.qrCodeId)
      .maybeSingle()

    if (qrErr) {
      if (isTableMissingError(qrErr)) {
        return { success: false, error: MIGRATION_REQUIRED_ERROR }
      }
      return { success: false, error: qrErr.message }
    }

    if (!qr?.workspace_id) {
      return { success: false, error: 'QR code not found or workspace missing.' }
    }

    const { error: insertErr } = await anyClient.from('qr_code_events').insert({
      qr_code_id: params.qrCodeId,
      workspace_id: qr.workspace_id,
      event_type: params.eventType,
      metadata: params.metadata || {},
    })

    if (insertErr) {
      if (isTableMissingError(insertErr)) {
        return { success: false, error: MIGRATION_REQUIRED_ERROR }
      }
      return { success: false, error: insertErr.message }
    }

    return { success: true }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to record event'
    return { success: false, error: msg }
  }
}
