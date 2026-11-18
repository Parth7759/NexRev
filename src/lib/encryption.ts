import crypto from 'crypto'

export interface TokenEncryptionReadiness {
  dedicatedKeyConfigured: boolean
  keyLength: number
  usingFallback: boolean
}

/**
 * Read-only readiness check for production OAuth token encryption hygiene.
 * Never exposes secret values and does not alter existing decryption behavior.
 */
export function getTokenEncryptionReadiness(): TokenEncryptionReadiness {
  const dedicatedKey = (process.env.TOKEN_ENCRYPTION_KEY || '').trim()
  const dedicatedKeyConfigured = dedicatedKey.length >= 32
  return {
    dedicatedKeyConfigured,
    keyLength: dedicatedKey.length,
    usingFallback: !dedicatedKey,
  }
}

/**
 * Derives a 32-byte encryption key for AES-256-GCM.
 * Prioritizes TOKEN_ENCRYPTION_KEY, with fallback derivation from server secrets.
 */
function getEncryptionKey(): Buffer {
  const secret =
    process.env.TOKEN_ENCRYPTION_KEY ||
    process.env.GOOGLE_CLIENT_SECRET ||
    'nexrev-fallback-token-encryption-salt-2026'

  return crypto.createHash('sha256').update(secret).digest()
}

/**
 * Encrypts a sensitive string using AES-256-GCM.
 * Returns a composite string: iv:authTag:ciphertext (all in hex format).
 */
export function encryptToken(plaintext: string): string {
  if (!plaintext) return ''

  const key = getEncryptionKey()
  const iv = crypto.randomBytes(12) // Standard 12-byte IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)

  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag().toString('hex')

  return `${iv.toString('hex')}:${authTag}:${encrypted}`
}

/**
 * Decrypts an AES-256-GCM encrypted composite string.
 * Validates integrity via GCM authentication tag.
 */
export function decryptToken(encryptedString: string): string {
  if (!encryptedString) return ''

  const parts = encryptedString.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format')
  }

  const [ivHex, authTagHex, encryptedText] = parts
  const key = getEncryptionKey()
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encryptedText, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}
