import { createRemoteJWKSet, jwtVerify, JWTVerifyGetKey } from 'jose'
import { NextRequest } from 'next/server'

// Google's public certificates endpoint for Cloud Pub/Sub and Google Accounts OIDC tokens
const GOOGLE_OAUTH2_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs'

// Valid issuers for Google-issued OIDC tokens
const VALID_GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

// Lazily initialized, in-memory cached remote JWK set with automatic key rotation
let googleJwks: JWTVerifyGetKey | null = null

function getGoogleJwks(): JWTVerifyGetKey {
  if (!googleJwks) {
    googleJwks = createRemoteJWKSet(new URL(GOOGLE_OAUTH2_CERTS_URL))
  }
  return googleJwks
}

export interface VerifyOidcOptions {
  audience?: string
  expectedServiceAccount?: string
  /**
   * Optional custom key set or key resolver for isolated unit testing
   */
  keyResolver?: Parameters<typeof jwtVerify>[1]
}

export interface OidcVerificationResult {
  valid: boolean
  error?: string
  claims?: {
    email?: string
    emailVerified?: boolean
    audience?: string | string[]
    issuer?: string
    subject?: string
    expiresAt?: number
  }
}

/**
 * Verifies a Google-signed OIDC JWT token attached by Google Cloud Pub/Sub push subscriptions.
 * Validates cryptographic signature via Google JWKS, issuer, expiration, audience, and service account email.
 */
export async function verifyGooglePubSubOidcToken(
  token: string,
  options?: VerifyOidcOptions
): Promise<OidcVerificationResult> {
  if (!token || typeof token !== 'string' || token.trim() === '') {
    return { valid: false, error: 'Token is empty or missing' }
  }

  const audience = options?.audience ?? process.env.GOOGLE_PUBSUB_PUSH_AUDIENCE
  const expectedServiceAccount =
    options?.expectedServiceAccount ?? process.env.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT
  const keyResolver = options?.keyResolver || getGoogleJwks()

  try {
    const { payload } = await jwtVerify(token, keyResolver, {
      issuer: VALID_GOOGLE_ISSUERS,
      ...(audience && audience.trim() !== '' ? { audience: audience.trim() } : {}),
    })

    // Validate expected service-account email if configured
    if (expectedServiceAccount && expectedServiceAccount.trim() !== '') {
      const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : ''
      const expected = expectedServiceAccount.trim().toLowerCase()

      if (email !== expected) {
        return {
          valid: false,
          error: `Service account email mismatch: expected "${expectedServiceAccount}", got "${payload.email || 'undefined'}"`,
        }
      }

      // Check email_verified (Google sets true for service account ID tokens)
      if (payload.email_verified !== true && payload.email_verified !== 'true') {
        return {
          valid: false,
          error: 'Service account email is not verified by Google',
        }
      }
    }

    return {
      valid: true,
      claims: {
        email: typeof payload.email === 'string' ? payload.email : undefined,
        emailVerified: payload.email_verified === true || payload.email_verified === 'true',
        audience: payload.aud,
        issuer: payload.iss,
        subject: payload.sub,
        expiresAt: payload.exp,
      },
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown JWT verification failure'
    return { valid: false, error: errorMsg }
  }
}

export interface WebhookAuthResult {
  authenticated: boolean
  status: number
  error?: string
  claims?: OidcVerificationResult['claims']
}

/**
 * Authenticates an incoming Google Cloud Pub/Sub push request to the webhook endpoint.
 *
 * Enforces:
 * 1. Google-signed OIDC JWT Bearer token validation (signature, issuer, expiry, audience, service account email).
 * 2. GOOGLE_PUBSUB_VERIFICATION_TOKEN check (via query param ?token= or x-goog-pubsub-verification-token header)
 *    if configured, providing an additional layer of defense.
 * 3. Rejection of unauthenticated or forged requests with HTTP 401.
 */
export async function authenticateGooglePubSubWebhook(
  request: NextRequest,
  options?: VerifyOidcOptions
): Promise<WebhookAuthResult> {
  const url = new URL(request.url)
  const queryToken =
    url.searchParams.get('token') ||
    url.searchParams.get('verification_token')
  const headerToken = request.headers.get('x-goog-pubsub-verification-token')
  const authHeader = request.headers.get('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null

  const expectedVerificationToken = process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN?.trim()
  const expectedAudience = (options?.audience ?? process.env.GOOGLE_PUBSUB_PUSH_AUDIENCE)?.trim()
  const expectedServiceAccount = (options?.expectedServiceAccount ?? process.env.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT)?.trim()

  const isOidcConfigured = Boolean(expectedAudience || expectedServiceAccount)
  const isTokenConfigured = Boolean(expectedVerificationToken && expectedVerificationToken !== '')

  let verifiedClaims: OidcVerificationResult['claims'] | undefined

  // 1. OIDC Authentication Check
  if (isOidcConfigured) {
    if (!bearerToken) {
      return {
        authenticated: false,
        status: 401,
        error: 'Unauthorized: Missing required Google Cloud Pub/Sub Authorization Bearer OIDC token',
      }
    }

    const oidcResult = await verifyGooglePubSubOidcToken(bearerToken, {
      audience: expectedAudience,
      expectedServiceAccount: expectedServiceAccount,
      keyResolver: options?.keyResolver,
    })

    if (!oidcResult.valid) {
      return {
        authenticated: false,
        status: 401,
        error: `Unauthorized: OIDC verification failed (${oidcResult.error})`,
      }
    }

    verifiedClaims = oidcResult.claims
  } else if (bearerToken && bearerToken.split('.').length === 3) {
    // If OIDC env vars are not set but an OIDC JWT is presented, verify signature & issuer against Google JWKS
    const oidcResult = await verifyGooglePubSubOidcToken(bearerToken, {
      keyResolver: options?.keyResolver,
    })

    if (oidcResult.valid) {
      verifiedClaims = oidcResult.claims
    } else if (isTokenConfigured && bearerToken === expectedVerificationToken) {
      // Allow legacy static bearer token match if it matches verification token exactly
    } else {
      return {
        authenticated: false,
        status: 401,
        error: `Unauthorized: Invalid Bearer OIDC token (${oidcResult.error})`,
      }
    }
  }

  // 2. Verification Token Check (if configured as secondary or primary guard)
  if (isTokenConfigured) {
    // If OIDC is active, verification token is expected in query param or x-goog-pubsub-verification-token
    // If OIDC is not active, it may also match a static bearer token
    const candidateToken = queryToken || headerToken || (!isOidcConfigured ? bearerToken : null)

    if (!candidateToken || candidateToken !== expectedVerificationToken) {
      return {
        authenticated: false,
        status: 401,
        error: 'Unauthorized: Invalid or missing Pub/Sub verification token',
      }
    }
  }

  // 3. Fallback: If neither OIDC nor verification token is configured in environment,
  // reject completely unauthenticated requests
  if (!isOidcConfigured && !isTokenConfigured) {
    if (!bearerToken && !queryToken && !headerToken) {
      return {
        authenticated: false,
        status: 401,
        error: 'Unauthorized: No authentication credentials provided in request',
      }
    }

    if (bearerToken && !verifiedClaims) {
      return {
        authenticated: false,
        status: 401,
        error: 'Unauthorized: Bearer token is not a valid Google-signed OIDC token',
      }
    }
  }

  return {
    authenticated: true,
    status: 200,
    claims: verifiedClaims,
  }
}
