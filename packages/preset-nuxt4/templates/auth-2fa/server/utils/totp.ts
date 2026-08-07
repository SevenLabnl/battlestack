import { generateSecret as makeSecret, generateURI, verifySync } from 'otplib'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// `epochTolerance` = accepted 30s steps each side of "now": default 2 (±60s) survives clock skew/latency; strict (NUXT_TOTP_STRICT=true) uses 1 (±30s).
// Read per-call from runtimeConfig, available in Nitro request handlers, so the toggle applies without a rebuild.
function verifyOpts() {
    const strict = useRuntimeConfig().totpStrict
    const isStrict = strict === true || String(strict) === 'true'
    return { strategy: 'totp' as const, epochTolerance: isStrict ? 1 : 2 }
}

function getEncryptionKey(): Buffer {
    const hex = useRuntimeConfig().totpEncryptionKey as string | undefined
    if (!hex || hex.length !== 64) {
        throw new Error(
            'NUXT_TOTP_ENCRYPTION_KEY missing or not 64 hex chars. ' +
                "Generate one with `node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"` and set it in .env.",
        )
    }
    return Buffer.from(hex, 'hex')
}

export function encryptSecret(plaintext: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`
}

export function decryptSecret(stored: string): string {
    const [ivHex, tagHex, ctHex] = stored.split(':')
    if (!ivHex || !tagHex || !ctHex) throw new Error('Invalid encrypted TOTP secret format')
    const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
    const dec = Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()])
    return dec.toString('utf8')
}

export function generateTotpSecret(): string {
    return makeSecret()
}

export function otpauthUrl(secret: string, email: string, issuer: string): string {
    return generateURI({ strategy: 'totp', issuer, label: email, secret })
}

export function verifyTotp(secret: string, code: string): boolean {
    const result = verifySync({ secret, token: code, ...verifyOpts() }) as
        | boolean
        | { valid: boolean }
    return typeof result === 'boolean' ? result : result.valid
}

export function verifyEncryptedTotp(encrypted: string, code: string): boolean {
    return verifyTotp(decryptSecret(encrypted), code)
}
