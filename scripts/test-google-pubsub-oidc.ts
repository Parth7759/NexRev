/* eslint-disable */
/**
 * Test Suite: Google Pub/Sub OIDC Authenticated Push Verification
 *
 * Verifies all requirements:
 * 1. Verify Google-signed OIDC JWT from the Pub/Sub push request's Authorization Bearer token.
 * 2. Validate signature, issuer, expiry, audience, and the expected service-account email.
 * 3. Use environment variables: GOOGLE_PUBSUB_PUSH_AUDIENCE and GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT.
 * 4. Keep GOOGLE_PUBSUB_VERIFICATION_TOKEN as an additional check only if compatible.
 * 5. Reject unauthenticated or invalid requests with HTTP 401.
 * 6. Zero real customer replies published (mock fixtures).
 */

import { generateKeyPair, SignJWT } from 'jose'
import { NextRequest } from 'next/server'
import {
  verifyGooglePubSubOidcToken,
  authenticateGooglePubSubWebhook,
} from '../src/lib/google-pubsub-auth'
import { POST as webhookPost } from '../src/app/api/webhooks/google-pubsub/route'

interface TestResult {
  suite: string
  name: string
  status: 'PASS' | 'FAIL'
  details: string
}

const results: TestResult[] = []

function assert(condition: boolean, suite: string, name: string, details: string) {
  if (condition) {
    results.push({ suite, name, status: 'PASS', details })
    console.log(`  ✅ [PASS] ${name}`)
  } else {
    results.push({ suite, name, status: 'FAIL', details })
    console.error(`  ❌ [FAIL] ${name} - ${details}`)
  }
}

async function runOidcTestSuite() {
  console.log('================================================================================')
  console.log('NexRep Google Cloud Pub/Sub Authenticated Push (OIDC) Test Suite')
  console.log('================================================================================')

  // Generate test RSA KeyPair for RS256 signing
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const { privateKey: attackerPrivateKey } = await generateKeyPair('RS256')

  const TEST_AUDIENCE = 'https://staging.nexrep.com/api/webhooks/google-pubsub'
  const TEST_SERVICE_ACCOUNT = 'pubsub-invoker@nexrep-staging.iam.gserviceaccount.com'
  const TEST_VERIFICATION_TOKEN = 'secret-staging-pubsub-token-xyz789'

  // Helper to create test OIDC tokens
  async function createTestOidcToken(options?: {
    issuer?: string
    audience?: string
    email?: string
    emailVerified?: boolean
    expiresIn?: string | number
    useAttackerKey?: boolean
  }) {
    const key = options?.useAttackerKey ? attackerPrivateKey : privateKey
    const jwt = new SignJWT({
      email: options?.email ?? TEST_SERVICE_ACCOUNT,
      email_verified: options?.emailVerified ?? true,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuer(options?.issuer ?? 'https://accounts.google.com')
      .setAudience(options?.audience ?? TEST_AUDIENCE)
      .setSubject('108611198428245728238')
      .setIssuedAt()
      .setExpirationTime(options?.expiresIn ?? '1h')

    return await jwt.sign(key)
  }

  // --- Suite 1: OIDC Token Cryptographic & Claims Validation ---
  console.log('\n--- Suite 1: OIDC Token Cryptographic & Claims Validation ---')

  // 1. Valid token
  const validToken = await createTestOidcToken()
  const resValid = await verifyGooglePubSubOidcToken(validToken, {
    audience: TEST_AUDIENCE,
    expectedServiceAccount: TEST_SERVICE_ACCOUNT,
    keyResolver: publicKey,
  })
  assert(
    resValid.valid === true && resValid.claims?.email === TEST_SERVICE_ACCOUNT,
    'Suite 1',
    'Valid Google OIDC JWT passes verification',
    `Expected valid=true, got: ${JSON.stringify(resValid)}`
  )

  // 2. Issuer verification ('accounts.google.com' vs 'https://accounts.google.com' vs invalid)
  const tokenAltIssuer = await createTestOidcToken({ issuer: 'accounts.google.com' })
  const resAltIssuer = await verifyGooglePubSubOidcToken(tokenAltIssuer, {
    audience: TEST_AUDIENCE,
    expectedServiceAccount: TEST_SERVICE_ACCOUNT,
    keyResolver: publicKey,
  })
  assert(
    resAltIssuer.valid === true,
    'Suite 1',
    'Accepts alternative Google issuer "accounts.google.com"',
    `Expected valid=true, got: ${JSON.stringify(resAltIssuer)}`
  )

  const tokenEvilIssuer = await createTestOidcToken({ issuer: 'https://evil-attacker.com' })
  const resEvilIssuer = await verifyGooglePubSubOidcToken(tokenEvilIssuer, {
    audience: TEST_AUDIENCE,
    expectedServiceAccount: TEST_SERVICE_ACCOUNT,
    keyResolver: publicKey,
  })
  assert(
    resEvilIssuer.valid === false && Boolean(resEvilIssuer.error?.includes('unexpected "iss" claim')),
    'Suite 1',
    'Rejects foreign or forged issuer',
    `Expected valid=false with iss error, got: ${JSON.stringify(resEvilIssuer)}`
  )

  // 3. Expiry verification
  const expiredJwt = new SignJWT({
    email: TEST_SERVICE_ACCOUNT,
    email_verified: true,
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer('https://accounts.google.com')
    .setAudience(TEST_AUDIENCE)
    .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)

  const expiredToken = await expiredJwt.sign(privateKey)
  const resExpired = await verifyGooglePubSubOidcToken(expiredToken, {
    audience: TEST_AUDIENCE,
    expectedServiceAccount: TEST_SERVICE_ACCOUNT,
    keyResolver: publicKey,
  })
  assert(
    resExpired.valid === false && Boolean(resExpired.error?.includes('expired') || resExpired.error?.includes('exp')),
    'Suite 1',
    'Rejects expired OIDC token',
    `Expected valid=false with expired error, got: ${JSON.stringify(resExpired)}`
  )

  // 4. Audience verification
  const tokenWrongAudience = await createTestOidcToken({ audience: 'https://other-domain.com/webhook' })
  const resWrongAudience = await verifyGooglePubSubOidcToken(tokenWrongAudience, {
    audience: TEST_AUDIENCE,
    expectedServiceAccount: TEST_SERVICE_ACCOUNT,
    keyResolver: publicKey,
  })
  assert(
    resWrongAudience.valid === false && Boolean(resWrongAudience.error?.includes('aud')),
    'Suite 1',
    'Rejects token with mismatched audience',
    `Expected valid=false with aud error, got: ${JSON.stringify(resWrongAudience)}`
  )

  // 5. Service account email verification
  const tokenWrongEmail = await createTestOidcToken({ email: 'attacker-account@malicious.iam.gserviceaccount.com' })
  const resWrongEmail = await verifyGooglePubSubOidcToken(tokenWrongEmail, {
    audience: TEST_AUDIENCE,
    expectedServiceAccount: TEST_SERVICE_ACCOUNT,
    keyResolver: publicKey,
  })
  assert(
    resWrongEmail.valid === false && Boolean(resWrongEmail.error?.includes('Service account email mismatch')),
    'Suite 1',
    'Rejects token from unexpected service account',
    `Expected valid=false with service account mismatch, got: ${JSON.stringify(resWrongEmail)}`
  )

  // 6. Signature forgery check
  const forgedToken = await createTestOidcToken({ useAttackerKey: true })
  const resForged = await verifyGooglePubSubOidcToken(forgedToken, {
    audience: TEST_AUDIENCE,
    expectedServiceAccount: TEST_SERVICE_ACCOUNT,
    keyResolver: publicKey,
  })
  assert(
    resForged.valid === false && Boolean(resForged.error?.includes('signature')),
    'Suite 1',
    'Rejects token with invalid/tampered cryptographic signature',
    `Expected valid=false with signature error, got: ${JSON.stringify(resForged)}`
  )

  // --- Suite 2: Webhook Request Authentication & HTTP 401 Enforcement ---
  console.log('\n--- Suite 2: Webhook Request Authentication & HTTP 401 Enforcement ---')

  // Set environment variables for test
  process.env.GOOGLE_PUBSUB_PUSH_AUDIENCE = TEST_AUDIENCE
  process.env.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT = TEST_SERVICE_ACCOUNT
  delete process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN

  // Helper to build NextRequest
  function buildPushRequest(headers?: Record<string, string>, urlSuffix = '') {
    return new NextRequest(`http://localhost:3001/api/webhooks/google-pubsub${urlSuffix}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({
        message: {
          data: Buffer.from(JSON.stringify({ eventType: 'TEST_HEARTBEAT' })).toString('base64'),
          messageId: `msg-${Date.now()}`,
        },
      }),
    })
  }

  // 1. Missing Authorization header when OIDC is configured -> 401
  const reqNoAuth = buildPushRequest()
  const authNoAuth = await authenticateGooglePubSubWebhook(reqNoAuth, { keyResolver: publicKey })
  assert(
    authNoAuth.authenticated === false && authNoAuth.status === 401,
    'Suite 2',
    'Missing Bearer token rejected with HTTP 401',
    `Got status: ${authNoAuth.status}, error: ${authNoAuth.error}`
  )

  // 2. Valid Authorization Bearer OIDC token -> 200 / authenticated
  const reqWithOidc = buildPushRequest({
    Authorization: `Bearer ${validToken}`,
  })
  const authWithOidc = await authenticateGooglePubSubWebhook(reqWithOidc, { keyResolver: publicKey })
  assert(
    authWithOidc.authenticated === true && authWithOidc.status === 200 && authWithOidc.claims?.email === TEST_SERVICE_ACCOUNT,
    'Suite 2',
    'Valid Google OIDC Bearer token accepted (HTTP 200 authenticated)',
    `Expected authenticated=true, got: ${JSON.stringify(authWithOidc)}`
  )

  // 3. Forged Bearer token -> 401
  const reqForged = buildPushRequest({
    Authorization: `Bearer ${forgedToken}`,
  })
  const authForged = await authenticateGooglePubSubWebhook(reqForged, { keyResolver: publicKey })
  assert(
    authForged.authenticated === false && authForged.status === 401,
    'Suite 2',
    'Forged Bearer token rejected with HTTP 401',
    `Got status: ${authForged.status}, error: ${authForged.error}`
  )

  // --- Suite 3: Defense in Depth (OIDC + GOOGLE_PUBSUB_VERIFICATION_TOKEN) ---
  console.log('\n--- Suite 3: Defense in Depth (OIDC + GOOGLE_PUBSUB_VERIFICATION_TOKEN) ---')

  // Set BOTH OIDC and verification token
  process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN = TEST_VERIFICATION_TOKEN

  // 1. Valid OIDC + Matching query token -> PASS
  const reqBothValidQuery = buildPushRequest(
    { Authorization: `Bearer ${validToken}` },
    `?token=${TEST_VERIFICATION_TOKEN}`
  )
  const authBothValidQuery = await authenticateGooglePubSubWebhook(reqBothValidQuery, { keyResolver: publicKey })
  assert(
    authBothValidQuery.authenticated === true,
    'Suite 3',
    'Dual protection PASS: Valid OIDC + matching query verification token',
    `Expected authenticated=true, got: ${JSON.stringify(authBothValidQuery)}`
  )

  // 2. Valid OIDC + Matching header token -> PASS
  const reqBothValidHeader = buildPushRequest({
    Authorization: `Bearer ${validToken}`,
    'x-goog-pubsub-verification-token': TEST_VERIFICATION_TOKEN,
  })
  const authBothValidHeader = await authenticateGooglePubSubWebhook(reqBothValidHeader, { keyResolver: publicKey })
  assert(
    authBothValidHeader.authenticated === true,
    'Suite 3',
    'Dual protection PASS: Valid OIDC + matching header verification token',
    `Expected authenticated=true, got: ${JSON.stringify(authBothValidHeader)}`
  )

  // 3. Valid OIDC + Missing verification token -> 401
  const reqOidcOnly = buildPushRequest({
    Authorization: `Bearer ${validToken}`,
  })
  const authOidcOnly = await authenticateGooglePubSubWebhook(reqOidcOnly, { keyResolver: publicKey })
  assert(
    authOidcOnly.authenticated === false && authOidcOnly.status === 401 && Boolean(authOidcOnly.error?.includes('verification token')),
    'Suite 3',
    'Dual protection REJECTS: Valid OIDC but missing verification token (HTTP 401)',
    `Expected 401, got: ${authOidcOnly.status}, error: ${authOidcOnly.error}`
  )

  // 4. Missing OIDC + Valid verification token -> 401
  const reqTokenOnly = buildPushRequest({}, `?token=${TEST_VERIFICATION_TOKEN}`)
  const authTokenOnly = await authenticateGooglePubSubWebhook(reqTokenOnly, { keyResolver: publicKey })
  assert(
    authTokenOnly.authenticated === false && authTokenOnly.status === 401 && Boolean(authTokenOnly.error?.includes('Missing required')),
    'Suite 3',
    'Dual protection REJECTS: Verification token present but missing OIDC Bearer token (HTTP 401)',
    `Expected 401, got: ${authTokenOnly.status}, error: ${authTokenOnly.error}`
  )

  // --- Suite 4: Backward Compatibility (Static Token Only) ---
  console.log('\n--- Suite 4: Backward Compatibility (Static Token Only) ---')

  delete process.env.GOOGLE_PUBSUB_PUSH_AUDIENCE
  delete process.env.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT
  process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN = TEST_VERIFICATION_TOKEN

  // 1. Static token in query param -> PASS
  const reqStaticQuery = buildPushRequest({}, `?token=${TEST_VERIFICATION_TOKEN}`)
  const authStaticQuery = await authenticateGooglePubSubWebhook(reqStaticQuery)
  assert(
    authStaticQuery.authenticated === true,
    'Suite 4',
    'Backward compatibility: Static token in query param passes',
    `Expected authenticated=true, got: ${JSON.stringify(authStaticQuery)}`
  )

  // 2. Static token in header -> PASS
  const reqStaticHeader = buildPushRequest({
    'x-goog-pubsub-verification-token': TEST_VERIFICATION_TOKEN,
  })
  const authStaticHeader = await authenticateGooglePubSubWebhook(reqStaticHeader)
  assert(
    authStaticHeader.authenticated === true,
    'Suite 4',
    'Backward compatibility: Static token in x-goog-pubsub-verification-token passes',
    `Expected authenticated=true, got: ${JSON.stringify(authStaticHeader)}`
  )

  // 3. Static token in Authorization: Bearer <static_token> -> PASS
  const reqStaticBearer = buildPushRequest({
    Authorization: `Bearer ${TEST_VERIFICATION_TOKEN}`,
  })
  const authStaticBearer = await authenticateGooglePubSubWebhook(reqStaticBearer)
  assert(
    authStaticBearer.authenticated === true,
    'Suite 4',
    'Backward compatibility: Static token in Bearer header passes',
    `Expected authenticated=true, got: ${JSON.stringify(authStaticBearer)}`
  )

  // 4. Wrong static token -> 401
  const reqWrongStatic = buildPushRequest({}, '?token=wrong-token')
  const authWrongStatic = await authenticateGooglePubSubWebhook(reqWrongStatic)
  assert(
    authWrongStatic.authenticated === false && authWrongStatic.status === 401,
    'Suite 4',
    'Backward compatibility: Wrong token rejected with HTTP 401',
    `Expected 401, got: ${authWrongStatic.status}`
  )

  // Clean up test environment variables
  delete process.env.GOOGLE_PUBSUB_PUSH_AUDIENCE
  delete process.env.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT
  delete process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN

  console.log('================================================================================')
  console.log('FINAL TEST EXECUTION SUMMARY')
  console.log('================================================================================')
  const total = results.length
  const passed = results.filter((r) => r.status === 'PASS').length
  const failed = results.filter((r) => r.status === 'FAIL').length
  console.log(`Total Assertions Checked: ${total}`)
  console.log(`Passed:                   ${passed}`)
  console.log(`Failed:                   ${failed}`)

  if (failed > 0) {
    console.error(`\n❌ ${failed} OIDC TEST(S) FAILED!`)
    process.exit(1)
  } else {
    console.log(`\n🎉 ALL ${passed} OIDC AUTHENTICATED PUSH TESTS PASSED!`)
  }
}

runOidcTestSuite().catch(console.error)
