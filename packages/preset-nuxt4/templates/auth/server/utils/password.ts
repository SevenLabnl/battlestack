import { hash, verify } from '@node-rs/argon2'

/** Hash a password with argon2. */
export function hashUserPassword(plain: string): Promise<string> {
    return hash(plain)
}

/** Verify a password against an argon2 hash. Empty stored hash is rejected. */
export async function verifyUserPassword(stored: string, plain: string): Promise<boolean> {
    if (!stored) return false
    return verify(stored, plain)
}
