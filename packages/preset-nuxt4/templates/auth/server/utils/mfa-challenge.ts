import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const TTL_MS = 5 * 60 * 1000

interface Payload {
    userId: string
    exp: number
    nonce: string
}

function getSecret(): string {
    const config = useRuntimeConfig()
    const secret = String(config.session?.password ?? '')
    if (!secret || secret.length < 32) {
        throw new Error('NUXT_SESSION_PASSWORD must be set (≥32 chars) to issue MFA challenges')
    }
    return secret
}

function sign(payloadB64: string, secret: string): string {
    return createHmac('sha256', secret).update(payloadB64).digest('base64url')
}

export function createMfaChallenge(userId: string): string {
    const payload: Payload = {
        userId,
        exp: Date.now() + TTL_MS,
        nonce: randomBytes(8).toString('base64url'),
    }
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
    return `${payloadB64}.${sign(payloadB64, getSecret())}`
}

export function consumeMfaChallenge(token: string): string | null {
    const [payloadB64, sig] = token.split('.')
    if (!payloadB64 || !sig) return null

    const expected = sign(payloadB64, getSecret())
    const a = Buffer.from(sig, 'base64url')
    const b = Buffer.from(expected, 'base64url')
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null

    let payload: Payload
    try {
        payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    } catch {
        return null
    }
    if (typeof payload.userId !== 'string' || typeof payload.exp !== 'number') return null
    if (payload.exp < Date.now()) return null
    return payload.userId
}
