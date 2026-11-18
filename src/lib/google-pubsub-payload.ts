export interface EmbeddedReviewObject {
  name?: string
  reviewId?: string
  starRating?: string
  comment?: string
  reviewer?: {
    displayName?: string
    profilePhotoUrl?: string
  }
  reviewReply?: {
    comment?: string
    updateTime?: string
  }
}

export interface DecodedNotificationPayload {
  type?: string
  eventType?: string
  event_type?: string
  location?: string | { name?: string; locationId?: string }
  review?: string | EmbeddedReviewObject
  resourceName?: string
  resource_name?: string
  name?: string
  reviewName?: string
  review_name?: string
  accountId?: string
  locationId?: string
  reviewId?: string
}

export interface ParsedGooglePubSubNotification {
  eventType: string
  isReviewEvent: boolean
  accountId: string
  locationId: string
  reviewId: string
  rawResourceName: string
  locationResourceName: string
  embeddedReview: EmbeddedReviewObject | null
  hasRequiredIdentifiers: boolean
  hasConflictingIdentifiers: boolean
  diagnosticSummary: {
    payloadKeys: string[]
    reviewFieldType: string
    locationFieldType: string
    hasAttributes: boolean
  }
}

function cleanSegment(value: string | undefined | null, prefix?: string): string {
  if (!value || typeof value !== 'string') return ''
  let trimmed = value.trim().replace(/^\/+|\/+$/g, '')
  if (prefix && trimmed.startsWith(`${prefix}/`)) {
    trimmed = trimmed.slice(prefix.length + 1)
  }
  // Reject values containing empty segments, whitespace, or path separators
  if (!trimmed || /\s/.test(trimmed) || trimmed.includes('/')) {
    return ''
  }
  return trimmed
}

function parseReviewResourceName(resource: string): {
  accountId: string
  locationId: string
  reviewId: string
} {
  const clean = resource.trim().replace(/^\/+|\/+$/g, '')
  if (!clean) {
    return { accountId: '', locationId: '', reviewId: '' }
  }

  // 1. Canonical GBP resource format: accounts/{accountId}/locations/{locationId}/reviews/{reviewId}
  const canonicalMatch = clean.match(/^accounts\/([^/\s]+)\/locations\/([^/\s]+)\/reviews\/([^/\s]+)$/)
  if (canonicalMatch) {
    return {
      accountId: canonicalMatch[1],
      locationId: canonicalMatch[2],
      reviewId: canonicalMatch[3],
    }
  }

  // 2. Location-scoped review resource format: locations/{locationId}/reviews/{reviewId}
  const locationScopedMatch = clean.match(/^locations\/([^/\s]+)\/reviews\/([^/\s]+)$/)
  if (locationScopedMatch) {
    return {
      accountId: '',
      locationId: locationScopedMatch[1],
      reviewId: locationScopedMatch[2],
    }
  }

  // 3. Review-only prefixed resource format: reviews/{reviewId}
  const reviewOnlyMatch = clean.match(/^reviews\/([^/\s]+)$/)
  if (reviewOnlyMatch) {
    return {
      accountId: '',
      locationId: '',
      reviewId: reviewOnlyMatch[1],
    }
  }

  return { accountId: '', locationId: '', reviewId: '' }
}

function parseLocationResourceName(resource: string): {
  accountId: string
  locationId: string
} {
  const clean = resource.trim().replace(/^\/+|\/+$/g, '')
  if (!clean) {
    return { accountId: '', locationId: '' }
  }

  // 1. Canonical GBP location format: accounts/{accountId}/locations/{locationId}
  const canonicalMatch = clean.match(/^accounts\/([^/\s]+)\/locations\/([^/\s]+)$/)
  if (canonicalMatch) {
    return {
      accountId: canonicalMatch[1],
      locationId: canonicalMatch[2],
    }
  }

  // 2. Short location format: locations/{locationId}
  const shortMatch = clean.match(/^locations\/([^/\s]+)$/)
  if (shortMatch) {
    return {
      accountId: '',
      locationId: shortMatch[1],
    }
  }

  return { accountId: '', locationId: '' }
}

/**
 * Parses a decoded Google Business Profile Pub/Sub notification payload.
 *
 * Supports:
 * - Official Google GBP Notifications v1 payload:
 *   { type: "NEW_REVIEW" | "UPDATED_REVIEW", location: "accounts/.../locations/...", review: "accounts/.../locations/.../reviews/..." }
 * - Legacy / object-based review formats:
 *   { eventType: "NEW_REVIEW", review: { name: "accounts/.../locations/.../reviews/...", ... } }
 * - Flat resourceName / reviewName / IDs / Pub/Sub message attributes.
 */
export function parseGooglePubSubNotificationPayload(
  payload: DecodedNotificationPayload | null | undefined,
  attributes?: Record<string, string>
): ParsedGooglePubSubNotification {
  const safePayload: DecodedNotificationPayload =
    payload && typeof payload === 'object' ? payload : {}

  // 1. Event type resolution: prefer official GBP `type`, preserve existing `eventType` / `event_type`
  const rawEventType =
    (typeof safePayload.type === 'string' && safePayload.type.trim()) ||
    (typeof safePayload.eventType === 'string' && safePayload.eventType.trim()) ||
    (typeof safePayload.event_type === 'string' && safePayload.event_type.trim()) ||
    (typeof attributes?.type === 'string' && attributes.type.trim()) ||
    (typeof attributes?.eventType === 'string' && attributes.eventType.trim()) ||
    (typeof attributes?.event_type === 'string' && attributes.event_type.trim()) ||
    'NEW_REVIEW'

  const eventType = rawEventType.toUpperCase()
  const isReviewEvent = eventType === 'NEW_REVIEW' || eventType === 'UPDATED_REVIEW'

  // 2. Embedded review object (only when `review` is an object, never when it's a resource string)
  const embeddedReview: EmbeddedReviewObject | null =
    safePayload.review && typeof safePayload.review === 'object' ? safePayload.review : null

  // 3. Extract raw review and location resource names
  const reviewResourceCandidate =
    (typeof safePayload.review === 'string' && safePayload.review.trim()) ||
    (typeof embeddedReview?.name === 'string' && embeddedReview.name.trim()) ||
    (typeof safePayload.resourceName === 'string' && safePayload.resourceName.trim()) ||
    (typeof safePayload.resource_name === 'string' && safePayload.resource_name.trim()) ||
    (typeof safePayload.name === 'string' && safePayload.name.trim()) ||
    (typeof safePayload.reviewName === 'string' && safePayload.reviewName.trim()) ||
    (typeof safePayload.review_name === 'string' && safePayload.review_name.trim()) ||
    (typeof attributes?.review === 'string' && attributes.review.trim()) ||
    (typeof attributes?.resourceName === 'string' && attributes.resourceName.trim()) ||
    ''

  const locationResourceCandidate =
    (typeof safePayload.location === 'string' && safePayload.location.trim()) ||
    (safePayload.location &&
      typeof safePayload.location === 'object' &&
      typeof safePayload.location.name === 'string' &&
      safePayload.location.name.trim()) ||
    (typeof attributes?.location === 'string' && attributes.location.trim()) ||
    ''

  const parsedReviewRes = parseReviewResourceName(reviewResourceCandidate)
  const parsedLocationRes = parseLocationResourceName(locationResourceCandidate)

  // Cross-field consistency check: if BOTH review and location resources specify accountId or locationId,
  // they MUST match (case-insensitively); conflicting identifiers are rejected safely.
  const accountIdConflict = Boolean(
    parsedReviewRes.accountId &&
      parsedLocationRes.accountId &&
      parsedReviewRes.accountId.toLowerCase() !== parsedLocationRes.accountId.toLowerCase()
  )
  const locationIdConflict = Boolean(
    parsedReviewRes.locationId &&
      parsedLocationRes.locationId &&
      parsedReviewRes.locationId.toLowerCase() !== parsedLocationRes.locationId.toLowerCase()
  )
  const hasConflictingIdentifiers = accountIdConflict || locationIdConflict

  // 4. Resolve clean accountId, locationId, reviewId
  const accountId =
    parsedReviewRes.accountId ||
    parsedLocationRes.accountId ||
    cleanSegment(safePayload.accountId, 'accounts') ||
    cleanSegment(attributes?.accountId, 'accounts') ||
    ''

  const locationObjId =
    safePayload.location && typeof safePayload.location === 'object'
      ? safePayload.location.locationId
      : undefined

  const locationId =
    parsedReviewRes.locationId ||
    parsedLocationRes.locationId ||
    cleanSegment(safePayload.locationId, 'locations') ||
    cleanSegment(locationObjId, 'locations') ||
    cleanSegment(attributes?.locationId, 'locations') ||
    ''

  const reviewId =
    parsedReviewRes.reviewId ||
    cleanSegment(safePayload.reviewId, 'reviews') ||
    cleanSegment(embeddedReview?.reviewId, 'reviews') ||
    cleanSegment(attributes?.reviewId, 'reviews') ||
    ''

  // Build canonical resource name if we extracted identifiers
  const canonicalResourceName =
    reviewResourceCandidate ||
    (accountId && locationId && reviewId
      ? `accounts/${accountId}/locations/${locationId}/reviews/${reviewId}`
      : locationId && reviewId
        ? `locations/${locationId}/reviews/${reviewId}`
        : '')

  const canonicalLocationResourceName =
    locationResourceCandidate ||
    (accountId && locationId
      ? `accounts/${accountId}/locations/${locationId}`
      : locationId
        ? `locations/${locationId}`
        : '')

  return {
    eventType,
    isReviewEvent,
    accountId,
    locationId,
    reviewId,
    rawResourceName: canonicalResourceName,
    locationResourceName: canonicalLocationResourceName,
    embeddedReview,
    hasRequiredIdentifiers: Boolean(locationId && reviewId && !hasConflictingIdentifiers),
    hasConflictingIdentifiers,
    diagnosticSummary: {
      payloadKeys: Object.keys(safePayload),
      reviewFieldType: safePayload.review === undefined ? 'undefined' : typeof safePayload.review,
      locationFieldType: safePayload.location === undefined ? 'undefined' : typeof safePayload.location,
      hasAttributes: Boolean(attributes && Object.keys(attributes).length > 0),
    },
  }
}

