'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/utils/supabase/server'
import { verifyWorkspaceMembership } from '@/lib/workspace'
import { checkRateLimit, getClientIpFromHeaders } from '@/lib/rate-limit'
import {
  getWorkspaceQrStudioOverview,
  createOrUpdateQrCode,
  getPublicQrCodeLandingData,
  recordQrCodeEvent,
  generateQrCodeSvg,
  generateQrCodeDataUrl,
  QrStudioOverview,
  QrCodeRecord,
  SaveQrCodeInput,
} from '@/lib/qr-service'

async function getOrigin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.trim().replace(/\/$/, '')
  }
  try {
    const headerList = await headers()
    const host = headerList.get('host') || 'localhost:3001'
    if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
      return `http://${host}`
    }
    const protocol = headerList.get('x-forwarded-proto') || 'https'
    return `${protocol}://${host}`
  } catch {
    return 'http://localhost:3001'
  }
}

export interface QrStudioPageData {
  success: boolean
  overview?: QrStudioOverview
  locations?: Array<{
    id: string
    name: string
    address: string | null
    googlePlaceId: string | null
    isConnected: boolean
  }>
  publicOrigin?: string
  error?: string
}

/**
 * Server Action: Loads QR Review Studio overview and locations for active workspace.
 */
export async function getQrStudioDataAction(
  workspaceId: string | null | undefined
): Promise<QrStudioPageData> {
  if (!workspaceId) {
    return { success: false, error: 'Please select a workspace.' }
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return { success: false, error: 'You must be signed in to access QR Review Studio.' }
  }

  const membership = await verifyWorkspaceMembership(supabase, workspaceId)
  if (!membership.isMember) {
    return { success: false, error: membership.error || 'Access denied.' }
  }

  const origin = await getOrigin()

  try {
    // 1. Fetch locations
    const { data: locationsData } = await supabase
      .from('locations')
      .select('id, name, address, google_place_id, is_connected')
      .eq('workspace_id', workspaceId)
      .order('is_connected', { ascending: false })

    const locations = (locationsData || []).map((l) => ({
      id: l.id,
      name: l.name,
      address: l.address,
      googlePlaceId: l.google_place_id,
      isConnected: Boolean(l.is_connected),
    }))

    // 2. Fetch overview
    const overview = await getWorkspaceQrStudioOverview(supabase, workspaceId)

    return {
      success: true,
      overview,
      locations,
      publicOrigin: origin,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to load QR Studio data.'
    return { success: false, error: msg }
  }
}

/**
 * Server Action: Generates or updates a QR code for a connected location.
 */
export async function saveQrCodeAction(
  input: SaveQrCodeInput
): Promise<{ success: boolean; qrCode?: QrCodeRecord; error?: string }> {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return { success: false, error: 'Authentication required.' }
  }

  const membership = await verifyWorkspaceMembership(supabase, input.workspaceId, [
    'owner',
    'admin',
  ])
  if (!membership.isMember) {
    return { success: false, error: 'Only workspace owners and administrators can create or edit QR codes.' }
  }

  const res = await createOrUpdateQrCode(supabase, input)
  if (res.success) {
    revalidatePath('/dashboard/qr', 'page')
  }
  return res
}

/**
 * Server Action: Generates visual QR assets (SVG and PNG Data URLs) for preview or printing.
 */
export async function getQrAssetsAction(
  slug: string
): Promise<{ success: boolean; svg?: string; dataUrl?: string; error?: string }> {
  try {
    const origin = await getOrigin()
    const targetUrl = `${origin}/review/${slug}`

    const [svg, dataUrl] = await Promise.all([
      generateQrCodeSvg(targetUrl),
      generateQrCodeDataUrl(targetUrl, { width: 800 }),
    ])

    return { success: true, svg, dataUrl }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Could not generate QR code graphics.'
    return { success: false, error: msg }
  }
}

/**
 * Public Server Action: Resolves public landing page data when a customer scans a QR code.
 */
export async function getPublicQrLandingDataAction(slug: string) {
  const supabase = await createClient()
  const result = await getPublicQrCodeLandingData(supabase, slug)

  if (result.success && result.qrCode) {
    // Record scan event asynchronously with multi-layer rate limiting:
    // 1. Per-IP rate limiting (using edge-verified headers to prevent IP spoofing)
    // 2. Global per-QR cap to prevent distributed bot inflation
    try {
      const headerList = await headers()
      const clientIp = getClientIpFromHeaders(headerList)
      const ipRate = checkRateLimit(`qr_scan:ip:${clientIp}:${result.qrCode.id}`, 20, 60 * 1000)
      const globalRate = checkRateLimit(`qr_scan:global:${result.qrCode.id}`, 120, 60 * 1000)

      if (ipRate.success && globalRate.success) {
        await recordQrCodeEvent(supabase, {
          qrCodeId: result.qrCode.id,
          eventType: 'scan',
        })
      }
    } catch {
      // non-blocking
    }
  }

  return result
}

/**
 * Public Server Action: Logs customer interactions (e.g. Continue to Google or AI suggestion).
 */
export async function recordPublicQrInteractionAction(
  qrCodeId: string,
  eventType: 'google_click' | 'suggestion_generated'
) {
  if (!qrCodeId) return { success: false }

  try {
    const headerList = await headers()
    const clientIp = getClientIpFromHeaders(headerList)

    // Dual-layer rate limiting: Per-IP cap (20/min) + global per-QR-code cap (120/min)
    const ipRate = checkRateLimit(`qr_interaction:ip:${clientIp}:${qrCodeId}:${eventType}`, 20, 60 * 1000)
    const globalRate = checkRateLimit(`qr_interaction:global:${qrCodeId}:${eventType}`, 120, 60 * 1000)

    if (!ipRate.success || !globalRate.success) {
      return { success: false, error: 'Rate limit reached' }
    }

    const supabase = await createClient()
    await recordQrCodeEvent(supabase, {
      qrCodeId,
      eventType,
    })
    return { success: true }
  } catch {
    return { success: false }
  }
}
