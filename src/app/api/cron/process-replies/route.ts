import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { autoProcessWorkspaceUnansweredReviews } from '@/lib/reply-automation'

/**
 * Scheduled Cron Job Endpoint: /api/cron/process-replies
 *
 * Automatically scans unanswered customer reviews across authorized workspaces,
 * generates personalized AI replies for every rating (1 to 5 stars),
 * and automatically publishes or saves as drafts according to each workspace's configured policy.
 *
 * Security:
 * - In production, requires `Authorization: Bearer <CRON_SECRET>` or `?secret=<CRON_SECRET>`.
 * - Vercel automatically passes this header for jobs configured in vercel.json.
 */
export async function GET(request: NextRequest) {
  return handleCronExecution(request)
}

export async function POST(request: NextRequest) {
  return handleCronExecution(request)
}

async function handleCronExecution(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  const url = new URL(request.url)
  const querySecret = url.searchParams.get('secret')

  // Enforce CRON_SECRET authorization: strictly required in production
  if (process.env.NODE_ENV === 'production' && (!cronSecret || cronSecret.trim() === '')) {
    return NextResponse.json(
      { success: false, error: 'Server misconfiguration: CRON_SECRET must be configured in production.' },
      { status: 500 }
    )
  }

  if (cronSecret && cronSecret.trim() !== '') {
    const isHeaderValid = authHeader === `Bearer ${cronSecret}`
    const isQueryValid = querySecret === cronSecret

    if (!isHeaderValid && !isQueryValid) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Invalid or missing CRON_SECRET.' },
        { status: 401 }
      )
    }
  }

  // Parse parameters
  const dryRunParam = url.searchParams.get('dryRun')
  const isDryRun = dryRunParam === 'true' || dryRunParam === '1'
  const workspaceId = url.searchParams.get('workspaceId') || undefined
  const limitParam = url.searchParams.get('limit')
  const limit = limitParam ? Math.min(100, Math.max(1, parseInt(limitParam, 10))) : 25

  // In production, background review processing requires SUPABASE_SERVICE_ROLE_KEY to bypass RLS
  if (process.env.NODE_ENV === 'production' && !isDryRun && (!process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY.trim() === '')) {
    return NextResponse.json(
      { success: false, error: 'Server misconfiguration: SUPABASE_SERVICE_ROLE_KEY must be configured in production for automated background review processing.' },
      { status: 500 }
    )
  }

  try {
    const supabase = createAdminClient()

    const result = await autoProcessWorkspaceUnansweredReviews(supabase, {
      workspaceId,
      limit,
      dryRun: isDryRun,
    })

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      ...result,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal cron execution failure'
    console.error('Cron process-replies error:', message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}
