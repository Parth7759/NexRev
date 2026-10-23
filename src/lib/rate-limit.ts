interface RateLimitRecord {
  count: number
  resetTime: number
}

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
