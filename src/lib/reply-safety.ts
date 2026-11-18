import { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'

export type TypedSupabaseClient = SupabaseClient<Database>

export type AutoReplyMode = 'manual_approval' | 'auto_publish_positive' | 'auto_publish_all'

export interface WorkspaceReplySettings {
  workspaceId: string
  autoReplyMode: AutoReplyMode
  requireApprovalForCritical: boolean
  defaultReplyTone: 'professional' | 'friendly' | 'concise' | 'empathetic'
  businessContext: string
  autoReplyMinRating: number
  autoReplyDelayMinutes: number
  negativeReviewAlertsEnabled?: boolean
  negativeReviewAlertThreshold?: number // 2 (1-2 stars) or 3 (1-3 stars)
}

export const DEFAULT_REPLY_SETTINGS: Omit<WorkspaceReplySettings, 'workspaceId'> = {
  autoReplyMode: 'manual_approval',
  requireApprovalForCritical: true,
  defaultReplyTone: 'professional',
  businessContext: '',
  autoReplyMinRating: 4,
  autoReplyDelayMinutes: 5,
  negativeReviewAlertsEnabled: true,
  negativeReviewAlertThreshold: 3,
}

/**
 * Extracts clean user business context text and embedded in-app configuration.
 * Avoids schema alterations by safely embedding extra preferences without migrations.
 */
export function parseBusinessContextAndConfig(raw: string | null | undefined): {
  cleanBusinessContext: string
  negativeReviewAlertsEnabled: boolean
  negativeReviewAlertThreshold: number
} {
  if (!raw) {
    return {
      cleanBusinessContext: '',
      negativeReviewAlertsEnabled: true,
      negativeReviewAlertThreshold: 3,
    }
  }

  const match = raw.match(/<!--nexrep-config:([\s\S]*?)-->/)
  let alertsEnabled = true
  let alertThreshold = 3

  if (match && match[1]) {
    try {
      const parsed = JSON.parse(match[1])
      if (typeof parsed.negativeReviewAlertsEnabled === 'boolean') {
        alertsEnabled = parsed.negativeReviewAlertsEnabled
      }
      if (typeof parsed.negativeReviewAlertThreshold === 'number') {
        alertThreshold = Math.min(5, Math.max(1, parsed.negativeReviewAlertThreshold))
      }
    } catch {
      // Fallback to defaults if JSON corrupt
    }
  }

  const cleanText = raw.replace(/<!--nexrep-config:[\s\S]*?-->/g, '').trim()
  return {
    cleanBusinessContext: cleanText,
    negativeReviewAlertsEnabled: alertsEnabled,
    negativeReviewAlertThreshold: alertThreshold,
  }
}

/**
 * Serializes clean business context text and in-app alert configuration.
 */
export function packBusinessContextAndConfig(
  cleanText: string,
  config: {
    negativeReviewAlertsEnabled: boolean
    negativeReviewAlertThreshold: number
  }
): string {
  const trimmed = (cleanText || '').replace(/<!--nexrep-config:[\s\S]*?-->/g, '').trim()
  const configStr = JSON.stringify({
    negativeReviewAlertsEnabled: Boolean(config.negativeReviewAlertsEnabled),
    negativeReviewAlertThreshold: config.negativeReviewAlertThreshold ?? 3,
  })
  return trimmed ? `${trimmed}\n<!--nexrep-config:${configStr}-->` : `<!--nexrep-config:${configStr}-->`
}

/**
 * Checks if a Supabase error indicates that the table does not exist in schema cache yet.
 */
function isTableMissingError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    Boolean(error.message?.includes('schema cache')) ||
    Boolean(error.message?.includes('does not exist'))
  )
}

/**
 * Retrieves per-workspace reply safety settings.
 * Returns safe default configuration if table or row does not exist yet.
 */
export async function getWorkspaceReplySettings(
  supabase: TypedSupabaseClient,
  workspaceId: string
): Promise<WorkspaceReplySettings> {
  try {
    const { data, error } = await supabase
      .from('workspace_settings')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (error) {
      if (!isTableMissingError(error)) {
        console.warn('Failed to fetch workspace settings, using safe defaults:', error.message)
      }
      return {
        workspaceId,
        ...DEFAULT_REPLY_SETTINGS,
      }
    }

    if (!data) {
      return {
        workspaceId,
        ...DEFAULT_REPLY_SETTINGS,
      }
    }

    const { cleanBusinessContext, negativeReviewAlertsEnabled, negativeReviewAlertThreshold } =
      parseBusinessContextAndConfig(data.business_context)

    return {
      workspaceId: data.workspace_id,
      autoReplyMode: data.auto_reply_mode,
      requireApprovalForCritical: data.require_approval_for_critical,
      defaultReplyTone: data.default_reply_tone,
      businessContext: cleanBusinessContext,
      autoReplyMinRating: data.auto_reply_min_rating,
      autoReplyDelayMinutes: data.auto_reply_delay_minutes,
      negativeReviewAlertsEnabled,
      negativeReviewAlertThreshold,
    }
  } catch {
    return {
      workspaceId,
      ...DEFAULT_REPLY_SETTINGS,
    }
  }
}

export interface SensitiveReviewCheck {
  isSensitive: boolean
  category?: 'legal_threat' | 'fraud_or_billing' | 'health_or_safety' | 'harassment_or_discrimination' | 'privacy_or_compliance'
  matchedTerm?: string
}

const SENSITIVE_CONTENT_RULES: Array<{
  category: NonNullable<SensitiveReviewCheck['category']>
  pattern: RegExp
}> = [
  {
    category: 'legal_threat',
    pattern: /\b(lawsuit|lawyer|attorney|legal\s+action|sue\s+you|suing|court\s+case|consumer\s+court)\b/i,
  },
  {
    category: 'fraud_or_billing',
    pattern: /\b(scam|scammer|scammers|fraud|fraudulent|ripped\s+off|stolen|theft|unauthorized\s+charge|chargeback)\b/i,
  },
  {
    category: 'health_or_safety',
    pattern: /\b(food\s+poisoning|allergic\s+reaction|hospitalized|health\s+inspector|injured|injury|contaminated|cockroach|rat\s+droppings)\b/i,
  },
  {
    category: 'harassment_or_discrimination',
    pattern: /\b(harass(?:ed|ment|ing)?|discriminat(?:ed|ion|ory)|racis[mt]|sexis[mt]|assault(?:ed)?|police\s+report|called\s+the\s+police)\b/i,
  },
  {
    category: 'privacy_or_compliance',
    pattern: /\b(data\s+breach|leaked\s+my\s+data|privacy\s+violation|hipaa|gdpr\s+violation)\b/i,
  },
]

/**
 * Detects high-risk or sensitive review content (legal threats, safety/health incidents,
 * fraud/scam accusations, harassment/discrimination, or privacy/compliance issues) that
 * should always be routed to manual human approval even on 4-5 star ratings.
 */
export function detectSensitiveReviewContent(
  reviewContent?: string | null
): SensitiveReviewCheck {
  const text = (reviewContent || '').trim()
  if (!text) return { isSensitive: false }

  for (const rule of SENSITIVE_CONTENT_RULES) {
    const match = text.match(rule.pattern)
    if (match) {
      return {
        isSensitive: true,
        category: rule.category,
        matchedTerm: match[0],
      }
    }
  }

  return { isSensitive: false }
}

/**
 * Determines whether a review reply may be automatically published or must require manual human review.
 */
export function evaluateReplyApprovalPolicy(
  rating: number,
  settings: WorkspaceReplySettings,
  reviewContent?: string | null
): {
  requiresApproval: boolean
  status: 'draft' | 'published'
  reason: string
  sensitiveCategory?: SensitiveReviewCheck['category']
} {
  // Rule 1: Manual Approval mode requires human review for ALL reviews
  if (settings.autoReplyMode === 'manual_approval') {
    return {
      requiresApproval: true,
      status: 'draft',
      reason: 'Workspace is configured for manual approval of all AI replies.',
    }
  }

  // Rule 1b: Sensitive / high-risk review content ALWAYS requires human approval regardless of star rating
  const sensitiveCheck = detectSensitiveReviewContent(reviewContent)
  if (sensitiveCheck.isSensitive) {
    return {
      requiresApproval: true,
      status: 'draft',
      reason: `Sensitive review content detected (${sensitiveCheck.category}): requires manual human review and approval.`,
      sensitiveCategory: sensitiveCheck.category,
    }
  }

  // Rule 2: Critical / negative reviews (1-3 stars) always require human approval if enabled
  if (settings.requireApprovalForCritical && rating <= 3) {
    return {
      requiresApproval: true,
      status: 'draft',
      reason: 'Critical rating (1-3 stars) requires human review and manual approval.',
    }
  }

  // Rule 3: Check minimum rating threshold (for auto_publish_all, threshold defaults to 1 star)
  const minThreshold =
    settings.autoReplyMode === 'auto_publish_all' && settings.autoReplyMinRating === 4
      ? 1
      : settings.autoReplyMinRating

  if (rating < minThreshold) {
    return {
      requiresApproval: true,
      status: 'draft',
      reason: `Rating of ${rating} is below the automatic publish threshold (${minThreshold} stars).`,
    }
  }

  // Rule 4: Positive-only mode allows 4-5 stars
  if (settings.autoReplyMode === 'auto_publish_positive') {
    if (rating >= 4) {
      return {
        requiresApproval: false,
        status: 'published',
        reason: 'Eligible for auto-publishing (4-5 stars positive review mode).',
      }
    }
    return {
      requiresApproval: true,
      status: 'draft',
      reason: 'Requires approval (rating is not positive).',
    }
  }

  // Rule 5: Auto-publish all mode
  if (settings.autoReplyMode === 'auto_publish_all') {
    return {
      requiresApproval: false,
      status: 'published',
      reason: 'Eligible for auto-publishing (auto-publish all enabled).',
    }
  }

  // Safe fallback
  return {
    requiresApproval: true,
    status: 'draft',
    reason: 'Defaulted to manual approval for safety.',
  }
}

export interface LogReplyParams {
  workspaceId: string
  reviewId: string
  replyId?: string | null
  userId?: string | null
  action: 'generated' | 'edited' | 'published' | 'failed'
  content?: string | null
  tone?: string | null
  errorMessage?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Logs a reply action (generated, edited, published, failed) to the audit trail.
 * Gracefully ignores table-missing errors so logging never breaks core workflows.
 */
export async function logReplyAudit(
  supabase: TypedSupabaseClient,
  params: LogReplyParams
): Promise<void> {
  try {
    const { error } = await supabase.from('review_reply_logs').insert({
      workspace_id: params.workspaceId,
      review_id: params.reviewId,
      reply_id: params.replyId || null,
      user_id: params.userId || null,
      action: params.action,
      content: params.content || null,
      tone: params.tone || null,
      error_message: params.errorMessage || null,
      metadata: (params.metadata || {}) as Database['public']['Tables']['review_reply_logs']['Insert']['metadata'],
    })

    if (error && !isTableMissingError(error)) {
      console.warn('Failed to record reply audit log:', error.message)
    }
  } catch (err) {
    // Non-blocking logging
    console.warn('Reply audit logging skipped:', err)
  }
}

/**
 * Checks for an existing reply to prevent duplicate insertions and handle safe edits.
 */
export async function findExistingReviewReply(
  supabase: TypedSupabaseClient,
  reviewId: string,
  workspaceId: string
): Promise<{ id: string; content: string; status: string } | null> {
  try {
    const { data } = await supabase
      .from('review_replies')
      .select('id, content, status')
      .eq('review_id', reviewId)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    return data || null
  } catch {
    return null
  }
}

/**
 * Checks whether Fully Automatic AI Replies for all 1-5 star reviews is active.
 */
export function isFullyAutomaticModeActive(settings: WorkspaceReplySettings): boolean {
  return settings.autoReplyMode === 'auto_publish_all' && !settings.requireApprovalForCritical
}

/**
 * Toggles Fully Automatic AI Replies (All 1-5 Star Reviews).
 * When active: AI generates and immediately publishes replies to Google for ALL ratings without human review.
 * When paused: Returns to manual approval mode where all replies are saved as drafts.
 */
export async function toggleFullyAutomaticReplies(
  supabase: TypedSupabaseClient,
  workspaceId: string,
  enable: boolean,
  userId?: string | null
): Promise<{ success: boolean; settings?: WorkspaceReplySettings; error?: string }> {
  try {
    const current = await getWorkspaceReplySettings(supabase, workspaceId)

    const updatedMode: AutoReplyMode = enable ? 'auto_publish_all' : 'manual_approval'
    const updatedCriticalApproval = !enable // false when full auto enabled, true when paused
    const updatedMinRating = enable ? 1 : 4

    const packedContext = packBusinessContextAndConfig(current.businessContext, {
      negativeReviewAlertsEnabled: current.negativeReviewAlertsEnabled ?? true,
      negativeReviewAlertThreshold: current.negativeReviewAlertThreshold ?? 3,
    })

    const { data, error } = await supabase
      .from('workspace_settings')
      .upsert({
        workspace_id: workspaceId,
        auto_reply_mode: updatedMode,
        require_approval_for_critical: updatedCriticalApproval,
        default_reply_tone: current.defaultReplyTone,
        business_context: packedContext,
        auto_reply_min_rating: updatedMinRating,
        auto_reply_delay_minutes: current.autoReplyDelayMinutes,
        updated_at: new Date().toISOString(),
      })
      .select('*')
      .single()

    if (error) {
      return { success: false, error: `Failed to update automation mode: ${error.message}` }
    }

    const { cleanBusinessContext, negativeReviewAlertsEnabled, negativeReviewAlertThreshold } =
      parseBusinessContextAndConfig(data.business_context)

    const newSettings: WorkspaceReplySettings = {
      workspaceId: data.workspace_id,
      autoReplyMode: data.auto_reply_mode,
      requireApprovalForCritical: data.require_approval_for_critical,
      defaultReplyTone: data.default_reply_tone,
      businessContext: cleanBusinessContext,
      autoReplyMinRating: data.auto_reply_min_rating,
      autoReplyDelayMinutes: data.auto_reply_delay_minutes,
      negativeReviewAlertsEnabled,
      negativeReviewAlertThreshold,
    }

    // Record audit log for automation state change
    try {
      await supabase.from('review_reply_logs').insert({
        workspace_id: workspaceId,
        review_id: '00000000-0000-0000-0000-000000000000', // System-level event marker
        user_id: userId || null,
        action: enable ? 'published' : 'edited',
        content: enable
          ? 'Fully Automatic AI Replies (1-5 Stars) ENABLED by authorized owner/admin.'
          : 'Fully Automatic AI Replies PAUSED by authorized owner/admin.',
        metadata: {
          event: 'fully_automatic_replies_toggled',
          enabled: enable,
          autoReplyMode: updatedMode,
          requireApprovalForCritical: updatedCriticalApproval,
          timestamp: new Date().toISOString(),
        },
      })
    } catch {
      // Non-blocking
    }

    return { success: true, settings: newSettings }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown toggle failure'
    return { success: false, error: msg }
  }
}

