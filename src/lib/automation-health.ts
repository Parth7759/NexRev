import type { GoogleConnectionHealthStatus } from '@/lib/reply-queue'
import type { AutoReplyMode } from '@/lib/reply-safety'

export type AutomationOverallStatus =
  | 'verified_active'
  | 'ready_awaiting_event'
  | 'degraded_worker_offline'
  | 'degraded_auth_required'
  | 'degraded_unverified_connection'
  | 'degraded_failures'
  | 'manual_mode'

export interface AutomationHealthInput {
  nowMs?: number
  // 1. Configured
  autoReplyMode: AutoReplyMode
  requireApprovalForCritical: boolean
  autoReplyDelayMinutes: number
  isFullyAutomatic: boolean
  // 2. Connected (strictly distinguishes stored token vs verified refresh & live GBP API)
  hasStoredIntegrationRow: boolean
  hasRequiredBusinessManageScope: boolean
  connectedLocationCount: number
  connectionHealthRow: {
    status: GoogleConnectionHealthStatus
    lastRefreshSucceededAt: string | null
    lastGbpApiVerifiedAt: string | null
    lastCheckedAt: string | null
    lastErrorCode: string | null
    lastErrorMessage: string | null
  } | null
  // 3. Receiving (real Pub/Sub events only: NEW_REVIEW / UPDATED_REVIEW)
  lastPubSubEventAt: string | null
  lastPubSubEventStatus: string | null
  // 4. Processing (Worker heartbeat + queue jobs)
  lastWorkerRunAt: string | null
  lastWorkerRunStatus: 'running' | 'succeeded' | 'failed' | null
  scheduledJobCount: number
  processingJobCount: number
  failedJobCount: number
  deadLetterJobCount: number
  failedReplyCount: number
  nextScheduledFor: string | null
  // 5. Publishing (AI auto-published replies ONLY: is_ai_generated = true AND status = 'published')
  lastAiAutoPublishedAt: string | null
  // Historical unanswered reviews count (separate from active queue)
  unansweredReviewCount: number
}

export interface EvaluatedAutomationHealth {
  overallStatus: AutomationOverallStatus
  headline: string
  badgeLabel: string
  summaryDetail: string
  configured: {
    isFullyAutomatic: boolean
    autoReplyMode: AutoReplyMode
    requireApprovalForCritical: boolean
    delayMinutes: number
  }
  connected: {
    status: GoogleConnectionHealthStatus
    label: string
    hasStoredToken: boolean
    hasRequiredScope: boolean
    singleProfileSelected: boolean
    lastRefreshSucceededAt: string | null
    lastGbpApiVerifiedAt: string | null
    lastErrorMessage: string | null
  }
  receiving: {
    hasRealPubSubEvent: boolean
    lastPubSubEventAt: string | null
    lastPubSubEventStatus: string | null
  }
  processing: {
    workerHealthy: boolean
    lastWorkerRunAt: string | null
    lastWorkerRunStatus: 'running' | 'succeeded' | 'failed' | null
    scheduledCount: number
    processingCount: number
    failedCount: number
    deadLetterCount: number
    nextScheduledFor: string | null
  }
  publishing: {
    hasVerifiedAutoPublish: boolean
    lastAiAutoPublishedAt: string | null
  }
  unansweredReviewCount: number
}

const WORKER_HEARTBEAT_FRESH_MS = 5 * 60 * 1000 // 5 minutes
const GBP_API_HEALTH_FRESH_MS = 60 * 60 * 1000 // 60 minutes

export function evaluateAutomationHealth(
  input: AutomationHealthInput
): EvaluatedAutomationHealth {
  const nowMs = input.nowMs ?? Date.now()
  const singleProfileSelected = input.connectedLocationCount === 1

  // --- Stage 2: Connected status (never assumes connected from DB token row alone) ---
  let effectiveConnStatus: GoogleConnectionHealthStatus = 'disconnected'
  let connLabel = 'Disconnected'

  if (!input.hasStoredIntegrationRow || !singleProfileSelected) {
    effectiveConnStatus = 'disconnected'
    connLabel = !input.hasStoredIntegrationRow
      ? 'Google Account Not Connected'
      : input.connectedLocationCount === 0
        ? 'No Business Profile Selected'
        : 'Multiple Profiles Active (Select One)'
  } else if (!input.hasRequiredBusinessManageScope) {
    effectiveConnStatus = 'revoked'
    connLabel = 'Missing Required Google Scope'
  } else if (!input.connectionHealthRow) {
    effectiveConnStatus = 'token_stored_unverified'
    connLabel = 'Token Stored (API Unverified)'
  } else if (
    input.connectionHealthRow.status === 'revoked' ||
    input.connectionHealthRow.status === 'refresh_failed'
  ) {
    effectiveConnStatus = input.connectionHealthRow.status
    connLabel =
      input.connectionHealthRow.status === 'revoked'
        ? 'Authorization Revoked — Reconnect'
        : 'Token Refresh Failed — Reconnect'
  } else if (input.connectionHealthRow.status === 'api_error') {
    effectiveConnStatus = 'api_error'
    connLabel = 'Google API Error'
  } else if (input.connectionHealthRow.status === 'connected_verified') {
    const verifiedMs = input.connectionHealthRow.lastGbpApiVerifiedAt
      ? Date.parse(input.connectionHealthRow.lastGbpApiVerifiedAt)
      : 0
    if (verifiedMs && nowMs - verifiedMs <= GBP_API_HEALTH_FRESH_MS) {
      effectiveConnStatus = 'connected_verified'
      connLabel = 'Verified GBP API Connected'
    } else {
      effectiveConnStatus = 'token_stored_unverified'
      connLabel = 'Token Stored (Verification Stale)'
    }
  } else {
    effectiveConnStatus = 'token_stored_unverified'
    connLabel = 'Token Stored (API Unverified)'
  }

  // --- Stage 4: Worker heartbeat health ---
  const lastWorkerMs = input.lastWorkerRunAt ? Date.parse(input.lastWorkerRunAt) : 0
  const workerHealthy = Boolean(
    lastWorkerMs &&
      nowMs - lastWorkerMs <= WORKER_HEARTBEAT_FRESH_MS &&
      input.lastWorkerRunStatus === 'succeeded'
  )

  const totalFailed = input.failedJobCount + input.deadLetterJobCount + input.failedReplyCount
  const hasRealPubSubEvent = Boolean(input.lastPubSubEventAt)
  const hasVerifiedAutoPublish = Boolean(input.lastAiAutoPublishedAt)

  // --- Overall Banner Status (strictly evidence-based) ---
  let overallStatus: AutomationOverallStatus
  let headline: string
  let badgeLabel: string
  let summaryDetail: string

  if (!input.isFullyAutomatic) {
    overallStatus = 'manual_mode'
    headline = 'Review Automation Paused / Manual Mode'
    badgeLabel = 'Manual Approval'
    summaryDetail =
      'AI replies require manual review or critical-review approval before publishing to Google.'
  } else if (
    effectiveConnStatus === 'disconnected' ||
    effectiveConnStatus === 'revoked' ||
    effectiveConnStatus === 'refresh_failed'
  ) {
    overallStatus = 'degraded_auth_required'
    headline = 'Automation Action Required — Google Reconnection Needed'
    badgeLabel = connLabel
    summaryDetail =
      input.connectionHealthRow?.lastErrorMessage ||
      'Google Business Profile authorization is missing, expired, or revoked. Reconnect Google to resume.'
  } else if (!workerHealthy) {
    overallStatus = 'degraded_worker_offline'
    headline = 'Automation Configured — Background Worker Offline'
    badgeLabel = 'Worker Offline'
    summaryDetail = input.lastWorkerRunAt
      ? `Settings are enabled (${input.autoReplyDelayMinutes}m delay), but the scheduled reply worker has not reported a healthy heartbeat in the last 5 minutes.`
      : `Settings are enabled (${input.autoReplyDelayMinutes}m delay), but no background worker heartbeat has been recorded yet.`
  } else if (
    effectiveConnStatus === 'token_stored_unverified' ||
    effectiveConnStatus === 'api_error'
  ) {
    overallStatus = 'degraded_unverified_connection'
    headline = 'Automation Configured — Google API Connectivity Unverified'
    badgeLabel = connLabel
    summaryDetail =
      'A Google token is stored in the database, but live Google Business Profile API access has not been recently verified.'
  } else if (input.deadLetterJobCount > 0 || input.failedReplyCount > 0) {
    overallStatus = 'degraded_failures'
    headline = 'Automation Degraded — Failed Jobs Need Attention'
    badgeLabel = `${totalFailed} Failed`
    summaryDetail =
      'One or more scheduled review reply jobs exhausted retries or failed publishing. Inspect errors before continuing.'
  } else if (!hasRealPubSubEvent || !hasVerifiedAutoPublish) {
    overallStatus = 'ready_awaiting_event'
    headline = 'Automation Ready — Awaiting First Verified Live Event'
    badgeLabel = `Ready (${input.autoReplyDelayMinutes}m delay)`
    summaryDetail =
      'Configured, Google API verified, and background worker is healthy. Waiting for a genuine Google review notification to complete end-to-end verification.'
  } else {
    overallStatus = 'verified_active'
    headline = '24/7 Event-Driven Review Automation Verified & Active'
    badgeLabel = `● Verified (${input.autoReplyDelayMinutes}m delay)`
    summaryDetail =
      'Google Pub/Sub ingestion, OAuth/GBP API access, delayed queue worker, and automatic AI reply publishing are all verified.'
  }

  return {
    overallStatus,
    headline,
    badgeLabel,
    summaryDetail,
    configured: {
      isFullyAutomatic: input.isFullyAutomatic,
      autoReplyMode: input.autoReplyMode,
      requireApprovalForCritical: input.requireApprovalForCritical,
      delayMinutes: input.autoReplyDelayMinutes,
    },
    connected: {
      status: effectiveConnStatus,
      label: connLabel,
      hasStoredToken: input.hasStoredIntegrationRow,
      hasRequiredScope: input.hasRequiredBusinessManageScope,
      singleProfileSelected,
      lastRefreshSucceededAt: input.connectionHealthRow?.lastRefreshSucceededAt ?? null,
      lastGbpApiVerifiedAt: input.connectionHealthRow?.lastGbpApiVerifiedAt ?? null,
      lastErrorMessage: input.connectionHealthRow?.lastErrorMessage ?? null,
    },
    receiving: {
      hasRealPubSubEvent,
      lastPubSubEventAt: input.lastPubSubEventAt,
      lastPubSubEventStatus: input.lastPubSubEventStatus,
    },
    processing: {
      workerHealthy,
      lastWorkerRunAt: input.lastWorkerRunAt,
      lastWorkerRunStatus: input.lastWorkerRunStatus,
      scheduledCount: input.scheduledJobCount,
      processingCount: input.processingJobCount,
      failedCount: totalFailed,
      deadLetterCount: input.deadLetterJobCount,
      nextScheduledFor: input.nextScheduledFor,
    },
    publishing: {
      hasVerifiedAutoPublish,
      lastAiAutoPublishedAt: input.lastAiAutoPublishedAt,
    },
    unansweredReviewCount: input.unansweredReviewCount,
  }
}
