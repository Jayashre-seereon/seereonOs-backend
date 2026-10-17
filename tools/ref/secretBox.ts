// Frozen copy of the Node reference's secret box (server/src/auth/secretBox.ts, removed with the Node server); the
// golden tests prove app/auth/secret_box.py byte-compatible with it.
// AES-256-GCM sealing of the TOTP secrets the shared 2FA logic stores (src/mock/secrets.ts). Synchronous (the shared
// handlers are synchronous). Format: "v1.<kid>:<iv b64url>:<ciphertext+tag b64url>" where kid identifies the key
// (first 8 hex chars of SHA-256 of the key) so keys can be rotated: seal with MFA_ENCRYPTION_KEY, open with it or
// with MFA_ENCRYPTION_KEY_PREVIOUS.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { SecretBox } from '@/mock/secrets'

interface Key {
  kid: string
  key: Buffer
}
/** any string of ≥ 32 characters → a 256-bit key (SHA-256 of the string; use `openssl rand -base64 48`) */
export function deriveKey(material: string): Key {
  const key = createHash('sha256').update('seereonos-mfa-v1\0' + material).digest()
  return { kid: createHash('sha256').update(key).digest('hex').slice(0, 8), key }
}

export function createSecretBox(current: string, previous: string[] = [], opts: { allowPlain?: boolean } = {}): SecretBox {
  const cur = deriveKey(current)
  const keys = new Map([cur, ...previous.filter(Boolean).map(deriveKey)].map((k) => [k.kid, k.key]))
  const AAD = Buffer.from('seereonos:totp-secret')
  return {
    seal(plain: string) {
      const iv = randomBytes(12)
      const c = createCipheriv('aes-256-gcm', cur.key, iv)
      c.setAAD(AAD)
      const ct = Buffer.concat([c.update(plain, 'utf8'), c.final(), c.getAuthTag()])
      return `v1.${cur.kid}:${iv.toString('base64url')}:${ct.toString('base64url')}`
    },
    open(sealed: string) {
      if (typeof sealed !== 'string') return null
      if (sealed.startsWith('plain:')) return opts.allowPlain ? sealed.slice(6) : null
      const m = /^v1\.([0-9a-f]{8}):([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)$/.exec(sealed)
      const key = m && keys.get(m[1])
      if (!m || !key) return null
      try {
        const buf = Buffer.from(m[3], 'base64url')
        const d = createDecipheriv('aes-256-gcm', key, Buffer.from(m[2], 'base64url'))
        d.setAAD(AAD)
        d.setAuthTag(buf.subarray(buf.length - 16))
        return Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString('utf8')
      } catch {
        return null
      }
    },
  }
}
