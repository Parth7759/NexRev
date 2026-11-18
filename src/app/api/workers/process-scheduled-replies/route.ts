import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/supabase/admin'
import {
  authenticateSchedulerWorkerRequest,
  runScheduledReplyWorker,
} from '@/lib/reply-queue'

/**
 * Read-only health check for the scheduled reply worker endpoint.
 * Never executes jobs or exposes secrets.
 */
export async function GET() {
  const audienceConfigured = Boolean(process.env.GOOGLE_SCHEDULER_WORKER_AUDIENCE?.trim())
  const serviceAccountConfigured = Boolean(
    process.env.GOOGLE_SCHEDULER_WORKER_SERVICE_ACCOUNT?.trim()
  )
  const workerSecretConfigured = Boolean(
    process.env.WORKER_SCHEDULER_SECRET && process.env.WORKER_SCHEDULER_SECRET.trim().length >= 32
  )

  return NextResponse.json({
    status: 'ok',
    service: 'NexRep Scheduled Review Reply Worker',
    authConfig: {
      oidcConfigured: audienceConfigured && serviceAccountConfigured,
      workerSecretConfigured,
      audienceConfigured,
      serviceAccountConfigured,
    },
    timestamp: new Date().toISOString(),
  })
}

/**
 * Protected Background Worker Endpoint: POST /api/workers/process-scheduled-replies
 *
 * Triggered every 1 minute by Google Cloud Scheduler with a dedicated OIDC service account.
 * Atomically claims due jobs (scheduled_for <= now()) via FOR UPDATE SKIP LOCKED,
 * enforces delay, approval, and duplicate guards, and records worker heartbeats.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateSchedulerWorkerRequest(request)
  if (!auth.authenticated) {
    console.warn('Scheduled reply worker unauthorized:', auth.error)
    return NextResponse.json(
      { success: false, error: auth.error || 'Unauthorized' },
      { status: auth.status || 401 }
    )
  }

  const url = new URL(request.url)
  const dryRunParam = url.searchParams.get('dryRun')
  const isDryRun = dryRunParam === 'true' || dryRunParam === '1'
  const limitParam = url.searchParams.get('limit')
  const parsedLimit = limitParam ? parseInt(limitParam, 10) : 10
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(50, parsedLimit)) : 10

  if (
    process.env.NODE_ENV === 'production' &&
    !isDryRun &&
    (!process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY.trim() === '')
  ) {
    return NextResponse.json(
      {
        success: false,
        error: 'Server misconfiguration: SUPABASE_SERVICE_ROLE_KEY is required for worker execution.',
      },
      { status: 500 }
    )
  }

  try {
    const supabase = createAdminClient()
    const summary = await runScheduledReplyWorker(supabase, {
      triggerSource: auth.triggerSource || 'cloud_scheduler',
      limit,
      dryRun: isDryRun,
    })

    return NextResponse.json(
      {
        ...summary,
        authenticatedAs: auth.serviceAccount || null,
        timestamp: new Date().toISOString(),
      },
      { status: summary.success ? 200 : 500 }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal worker execution failure'
    console.error('Scheduled reply worker error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

