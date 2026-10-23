export type SubscriptionPlanId = 'starter' | 'professional' | 'agency'

export interface PlanLimits {
  name: string
  maxLocations: number
  maxMembersPerWorkspace: number
  monthlyAiRepliesLimit: number
  googleSyncIntervalMinutes: number
  features: {
    autoReplyRules: boolean
    customAiTone: boolean
    auditLogs: boolean
    prioritySupport: boolean
  }
}

export const SUBSCRIPTION_PLANS: Record<SubscriptionPlanId, PlanLimits> = {
  starter: {
    name: 'Starter Plan',
    maxLocations: 1,
    maxMembersPerWorkspace: 3,
    monthlyAiRepliesLimit: 50,
    googleSyncIntervalMinutes: 60,
    features: {
      autoReplyRules: false,
      customAiTone: false,
      auditLogs: false,
      prioritySupport: false,
    },
  },
  professional: {
    name: 'Professional Plan',
    maxLocations: 5,
    maxMembersPerWorkspace: 10,
    monthlyAiRepliesLimit: 250,
    googleSyncIntervalMinutes: 15,
    features: {
      autoReplyRules: true,
      customAiTone: true,
      auditLogs: true,
      prioritySupport: false,
    },
  },
  agency: {
    name: 'Agency Enterprise Plan',
    maxLocations: 50,
    maxMembersPerWorkspace: 50,
    monthlyAiRepliesLimit: 1500,
    googleSyncIntervalMinutes: 5,
    features: {
      autoReplyRules: true,
      customAiTone: true,
      auditLogs: true,
      prioritySupport: true,
    },
  },
}

export interface WorkspaceUsageSummary {
  planId: SubscriptionPlanId
  planName: string
  locationsCount: number
  maxLocations: number
  membersCount: number
  maxMembers: number
  monthlyAiRepliesUsed: number
  monthlyAiRepliesLimit: number
  canAddLocation: boolean
  canInviteMember: boolean
  canGenerateReply: boolean
}

/**
 * Evaluates current workspace usage against subscription limits.
 * Ready for future Stripe / payment gateway customer linking.
 */
export function evaluateWorkspaceUsage(
  planId: SubscriptionPlanId = 'professional',
  currentUsage: {
    locationsCount: number
    membersCount: number
    monthlyRepliesCount: number
  }
): WorkspaceUsageSummary {
  const plan = SUBSCRIPTION_PLANS[planId] || SUBSCRIPTION_PLANS.professional

  return {
    planId,
    planName: plan.name,
    locationsCount: currentUsage.locationsCount,
    maxLocations: plan.maxLocations,
    membersCount: currentUsage.membersCount,
    maxMembers: plan.maxMembersPerWorkspace,
    monthlyAiRepliesUsed: currentUsage.monthlyRepliesCount,
    monthlyAiRepliesLimit: plan.monthlyAiRepliesLimit,
    canAddLocation: currentUsage.locationsCount < plan.maxLocations,
    canInviteMember: currentUsage.membersCount < plan.maxMembersPerWorkspace,
    canGenerateReply: currentUsage.monthlyRepliesCount < plan.monthlyAiRepliesLimit,
  }
}
