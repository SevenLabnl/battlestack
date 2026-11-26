import { describe, expect, it } from 'vitest'
import { loginSecret } from '../src/features/auth.js'

const SECRET = 'a'.repeat(32)
const LEGACY = 'b'.repeat(32)

describe('loginSecret', () => {
    it('signs with NUXT_APP_SECRET, also when the legacy key is still there', () => {
        expect(loginSecret(new Map([['NUXT_APP_SECRET', SECRET]]))).toBe(SECRET)
        expect(loginSecret(new Map([['NUXT_APP_SECRET', SECRET], ['NUXT_SESSION_PASSWORD', LEGACY]]))).toBe(SECRET)
    })

    it('signs with NUXT_SESSION_PASSWORD for a project not yet pulled past nuxt-auth-utils 0.6', () => {
        expect(loginSecret(new Map([['NUXT_SESSION_PASSWORD', LEGACY]]))).toBe(LEGACY)
    })

    it('refuses a missing or short secret and names both keys', () => {
        expect(() => loginSecret(new Map())).toThrow(/NUXT_APP_SECRET nor NUXT_SESSION_PASSWORD/)
        expect(() => loginSecret(new Map([['NUXT_APP_SECRET', 'short']]))).toThrow(/battlestack pull/)
    })
})
