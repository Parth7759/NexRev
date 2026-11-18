/**
 * Dynamic per-workspace / per-location business identity resolution for AI replies.
 *
 * Guarantees:
 * - Never hardcodes any specific customer name (e.g. NexFlowOps) or platform name (e.g. NexRep).
 * - Resolves identity dynamically from the connected Google Business Profile location name first,
 *   then workspace name (excluding generic auto-generated "'s Workspace" names), then neutral fallback.
 * - Never promotes freeform business_context descriptions into businessName.
 * - Prevents leftover SaaS platform placeholder copy ("NexRep is a premium customer reputation
 *   management platform.") from leaking into public customer replies unless the business itself
 *   is actually named NexRep.
 */

export interface ResolveBusinessIdentityInput {
  locationName?: string | null
  businessName?: string | null
  workspaceName?: string | null
  businessContext?: string | null
}

export interface ResolvedBusinessIdentity {
  /** Authoritative business name to represent in public review replies */
  businessName: string
  /** True when a real business/location/workspace name was resolved (not neutral fallback) */
  hasExplicitBusinessName: boolean
  /** Optional branch/location qualifier ONLY when distinct from businessName */
  branchLabel?: string
  /** Cleaned supplemental workspace business context (never platform placeholder bleed) */
  businessContext?: string
  /** True only when the customer's own resolved business name literally contains "NexRep" */
  isPlatformNamedBusiness: boolean
}

const GENERIC_WORKSPACE_PATTERNS = [
  /^my\s+business$/i,
  /^my\s+workspace$/i,
  /'s\s+workspace$/i,
  /^default\s+workspace$/i,
]

const LEGACY_PLATFORM_SEED_PATTERNS = [
  /^nexrep\s+is\s+a\s+(?:premium\s+)?(?:b2b\s+|customer\s+)?reputation\s+management\s+platform\.?$/i,
  /^nexrep\s*[-—:]\s*ai\s+google\s+review\s+management\.?$/i,
]

function normalizeClean(value?: string | null): string {
  return (value || '').replace(/\s+/g, ' ').trim()
}

function isGenericWorkspaceName(name: string): boolean {
  return GENERIC_WORKSPACE_PATTERNS.some((pattern) => pattern.test(name))
}

/**
 * Strips embedded internal config markers and filters out leftover SaaS platform
 * placeholder copy so it never overrides or leaks into a customer's public reply.
 */
export function sanitizeBusinessContext(
  rawContext?: string | null,
  resolvedBusinessName?: string | null
): string | undefined {
  if (!rawContext) return undefined

  const withoutConfig = rawContext.replace(/<!--nexrep-config:[\s\S]*?-->/g, '').trim()
  if (!withoutConfig) return undefined

  const isPlatformNamedBusiness = /\bnexrep\b/i.test(resolvedBusinessName || '')
  if (isPlatformNamedBusiness) {
    return withoutConfig
  }

  const keptLines = withoutConfig
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false
      return !LEGACY_PLATFORM_SEED_PATTERNS.some((pattern) => pattern.test(line))
    })

  const cleaned = keptLines.join('\n').trim()
  return cleaned || undefined
}

/**
 * Resolves the authoritative business identity for a review reply dynamically per workspace/location.
 */
export function resolveBusinessIdentity(
  input: ResolveBusinessIdentityInput
): ResolvedBusinessIdentity {
  const cleanLocation = normalizeClean(input.locationName)
  const cleanExplicitBusiness = normalizeClean(input.businessName)
  const cleanWorkspace = normalizeClean(input.workspaceName)

  let resolvedName = ''
  let branchLabel: string | undefined

  const hasValidExplicitBusiness = Boolean(
    cleanExplicitBusiness && cleanExplicitBusiness.toLowerCase() !== 'our business'
  )

  if (cleanLocation && hasValidExplicitBusiness) {
    if (cleanLocation.toLowerCase() === cleanExplicitBusiness.toLowerCase()) {
      resolvedName = cleanLocation
    } else {
      resolvedName = cleanExplicitBusiness
      branchLabel = cleanLocation
    }
  } else if (cleanLocation) {
    resolvedName = cleanLocation
  } else if (hasValidExplicitBusiness) {
    resolvedName = cleanExplicitBusiness
  } else if (cleanWorkspace && !isGenericWorkspaceName(cleanWorkspace)) {
    resolvedName = cleanWorkspace
  }

  const hasExplicitBusinessName = Boolean(resolvedName)
  const finalBusinessName = resolvedName || 'our business'

  const isPlatformNamedBusiness = /\bnexrep\b/i.test(finalBusinessName)
  const cleanedContext = sanitizeBusinessContext(input.businessContext, finalBusinessName)

  return {
    businessName: finalBusinessName,
    hasExplicitBusinessName,
    branchLabel,
    businessContext: cleanedContext,
    isPlatformNamedBusiness,
  }
}
