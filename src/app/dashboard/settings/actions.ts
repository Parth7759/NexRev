'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/utils/supabase/server'
import { verifyWorkspaceMembership } from '@/lib/workspace'
import {
  getWorkspaceReplySettings,
  DEFAULT_REPLY_SETTINGS,
  AutoReplyMode,
  packBusinessContextAndConfig,
} from '@/lib/reply-safety'

export interface SaveSettingsInput {
  autoReplyMode: AutoReplyMode
  requireApprovalForCritical: boolean
  defaultReplyTone: 'professional' | 'friendly' | 'concise' | 'empathetic'
  businessContext: string
  autoReplyMinRating?: number
  autoReplyDelayMinutes?: number
  negativeReviewAlertsEnabled?: boolean
  negativeReviewAlertThreshold?: number
}

export async function getSettingsPageDataAction(workspaceId?: string | null) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return {
      authenticated: false,
      user: null,
      settings: null,
      userRole: null,
    }
  }

  // Get user profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', user.id)
    .maybeSingle()

  const userName = profile?.full_name || user.user_metadata?.full_name || ''
  const userEmail = profile?.email || user.email || ''

  if (!workspaceId) {
    return {
      authenticated: true,
      user: { name: userName, email: userEmail },
      settings: { ...DEFAULT_REPLY_SETTINGS, workspaceId: '' },
      userRole: null,
    }
  }

  // Check workspace membership
  const membership = await verifyWorkspaceMembership(supabase, workspaceId)
  if (!membership.isMember) {
    return {
      authenticated: true,
      user: { name: userName, email: userEmail },
      settings: { ...DEFAULT_REPLY_SETTINGS, workspaceId },
      userRole: null,
    }
  }

  const settings = await getWorkspaceReplySettings(supabase, workspaceId)

  return {
    authenticated: true,
    user: { name: userName, email: userEmail },
    settings,
    userRole: membership.role,
  }
}

export async function saveWorkspaceSettingsAction(
  workspaceId: string,
  input: SaveSettingsInput
) {
  if (!workspaceId) {
    return { success: false, error: 'Workspace ID is required.' }
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return { success: false, error: 'You must be signed in to change workspace settings.' }
  }

  // Authorization: Only owner or admin may modify workspace settings
  const membership = await verifyWorkspaceMembership(supabase, workspaceId, ['owner', 'admin'])
  if (!membership.isMember) {
    return {
      success: false,
      error: membership.error || 'Only workspace owners and administrators can change settings.',
    }
  }

  try {
    const packedBusinessContext = packBusinessContextAndConfig(input.businessContext, {
      negativeReviewAlertsEnabled: input.negativeReviewAlertsEnabled ?? true,
      negativeReviewAlertThreshold: input.negativeReviewAlertThreshold ?? 3,
    })

    const { error: upsertError } = await supabase
      .from('workspace_settings')
      .upsert({
        workspace_id: workspaceId,
        auto_reply_mode: input.autoReplyMode,
        require_approval_for_critical: input.requireApprovalForCritical,
        default_reply_tone: input.defaultReplyTone,
        business_context: packedBusinessContext,
        auto_reply_min_rating:
          typeof input.autoReplyMinRating === 'number'
            ? input.autoReplyMinRating
            : (input.autoReplyMode === 'auto_publish_all' ? 1 : 4),
        auto_reply_delay_minutes: input.autoReplyDelayMinutes || 5,
        updated_at: new Date().toISOString(),
      })

    if (upsertError) {
      return { success: false, error: `Failed to save settings: ${upsertError.message}` }
    }

    revalidatePath('/dashboard', 'layout')
    revalidatePath('/dashboard/settings', 'page')
    revalidatePath('/dashboard/reviews', 'page')
    return { success: true, message: 'Settings saved successfully.' }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to update settings.'
    return { success: false, error: msg }
  }
}

export async function updateProfileNameAction(fullName: string) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return { success: false, error: 'Not authenticated.' }
  }

  const trimmed = fullName.trim()
  if (!trimmed) {
    return { success: false, error: 'Name cannot be empty.' }
  }

  const { error } = await supabase
    .from('profiles')
    .update({ full_name: trimmed, updated_at: new Date().toISOString() })
    .eq('id', user.id)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath('/dashboard/settings', 'page')
  return { success: true, message: 'Profile updated successfully.' }
}
