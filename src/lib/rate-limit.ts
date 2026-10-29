interface RateLimitRecord {
  count: number
  resetTime: number
}

/**
 * ARCHITECTURAL NOTE ON RATE LIMITING:
 * 
 * 1. Scope & Execution Environment:
 *    The `rateLimitMap` below is an in-memory sliding window cache scoped to the current
 *    server process / serverless instance (Node.js runtime).
 *    - In multi-instance or serverless environments (e.g. Vercel Lambda / Edge), each instance
 *      maintains its own isolated memory map.
 *    - In-memory rate limiting provides fast, zero-latency burst protection against aggressive
 *      single-instance flooding and client-side loops.
 *    - For strict distributed rate limiting across thousands of concurrent serverless lambdas,
 *      an external shared state store (e.g., Upstash Redis, Vercel KV) is recommended.
 *    - Telemetry inflation protection is therefore enforced as defense-in-depth:
 *      (a) In-memory rate limiting per client IP + per QR entity in Next.js Server Actions.
 *      (b) Strict database-level RPC validation (`record_public_qr_event`) verifying active status
 *          and assigning `workspace_id` internally.
 */

// In-memory sliding window rate limiter
const rateLimitMap = new Map<string, RateLimitRecord>()

export function checkRateLimit(
  identifier: string,
  limit = 10,
  windowMs = 60 * 1000
): { success: boolean; remaining: number; resetMs: number } {
  const now = Date.now()
  const record = rateLimitMap.get(identifier)

  if (!record || now > record.resetTime) {
    rateLimitMap.set(identifier, {
      count: 1,
      resetTime: now + windowMs,
    })
    return { success: true, remaining: limit - 1, resetMs: windowMs }
  }

  if (record.count >= limit) {
    return { success: false, remaining: 0, resetMs: Math.max(0, record.resetTime - now) }
  }

  record.count += 1
  return { success: true, remaining: limit - record.count, resetMs: Math.max(0, record.resetTime - now) }
}

/**
 * Safely resolves the client IP address from incoming request headers,
 * prioritizing edge proxy headers (x-real-ip, cf-connecting-ip, x-vercel-ip)
 * that cannot be spoofed by external clients when deployed behind reverse proxies.
 *
 * PROXY CONFIGURATION DETAILS:
 * - Vercel Edge: Automatically overwrites `x-real-ip` and `x-vercel-ip` with the true TCP client address.
 * - Cloudflare: Injects `cf-connecting-ip` based on the client connection.
 * - Arbitrary `x-forwarded-for`: If a client prepends a fake IP, standard proxies append the real IP.
 *   Taking raw `x-forwarded-for` without prioritizing verified edge headers is unsafe.
 */
export function getClientIpFromHeaders(
  headers: { get: (name: string) => string | null }
): string {
  // 1. Direct edge-injected headers (overwritten by reverse proxies / CDNs)
  const realIp = headers.get('x-real-ip')
  if (realIp && realIp.trim()) {
    return realIp.trim()
  }

  const cfConnectingIp = headers.get('cf-connecting-ip')
  if (cfConnectingIp && cfConnectingIp.trim()) {
    return cfConnectingIp.trim()
  }

  const vercelIp = headers.get('x-vercel-ip')
  if (vercelIp && vercelIp.trim()) {
    return vercelIp.trim()
  }

  // 2. X-Forwarded-For: Extract first IP from proxy chain
  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const ips = xff.split(',').map((ip) => ip.trim()).filter(Boolean)
    if (ips.length > 0) {
      return ips[0].replace(/^\[|\]$/g, '').split(':')[0] || ips[0]
    }
  }

  return '127.0.0.1'
}
