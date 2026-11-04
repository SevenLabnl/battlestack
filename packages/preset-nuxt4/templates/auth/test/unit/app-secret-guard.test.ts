import { describe, expect, it } from 'vitest'
import {
    assertValidAppSecretUnlessDev,
    isValidAppSecret,
    MIN_APP_SECRET_LENGTH,
} from '#server/utils/app-secret'

const VALID_SECRET = 'a'.repeat(MIN_APP_SECRET_LENGTH)
const SHORT_SECRET = 'a'.repeat(MIN_APP_SECRET_LENGTH - 1)

describe('assertValidAppSecretUnlessDev', () => {
    it('throws when not a dev build and the secret is absent', () => {
        expect(() => assertValidAppSecretUnlessDev(false, '')).toThrow(
            /NUXT_APP_SECRET is not set/,
        )
    })

    it('throws when not a dev build and the secret is too short', () => {
        expect(() => assertValidAppSecretUnlessDev(false, SHORT_SECRET)).toThrow(
            /NUXT_APP_SECRET is too short/,
        )
    })

    it('does not throw when not a dev build but the secret is valid', () => {
        expect(() => assertValidAppSecretUnlessDev(false, VALID_SECRET)).not.toThrow()
    })

    it('does not throw on a dev build, even absent or short: the ONE case that skips validation', () => {
        expect(() => assertValidAppSecretUnlessDev(true, '')).not.toThrow()
        expect(() => assertValidAppSecretUnlessDev(true, SHORT_SECRET)).not.toThrow()
    })

    it('mentions the exact env var and the same-value-across-instances requirement', () => {
        try {
            assertValidAppSecretUnlessDev(false, '')
            expect.fail('expected assertValidAppSecretUnlessDev to throw')
        } catch (err) {
            const message = (err as Error).message
            expect(message).toContain('NUXT_APP_SECRET')
            expect(message).toContain('same value on every running instance')
        }
    })

    // Pinned explicitly, not just `true`/`false`: restructured to ask "is this production" instead of
    // "is this dev", the guard would skip on anything non-boolean, the wrong direction for a security boundary.
    it('validates (fails closed) for anything that is not exactly `true`', () => {
        // @ts-expect-error deliberately non-boolean, proving the guard does not short-circuit on a truthy-but-wrong value.
        expect(() => assertValidAppSecretUnlessDev(1, '')).toThrow(/NUXT_APP_SECRET/)
        // @ts-expect-error same, for `undefined`.
        expect(() => assertValidAppSecretUnlessDev(undefined, '')).toThrow(/NUXT_APP_SECRET/)
    })
})

describe('isValidAppSecret', () => {
    it('rejects anything shorter than MIN_APP_SECRET_LENGTH', () => {
        expect(isValidAppSecret(SHORT_SECRET)).toBe(false)
        expect(isValidAppSecret('')).toBe(false)
    })

    it('accepts exactly MIN_APP_SECRET_LENGTH characters and above', () => {
        expect(isValidAppSecret(VALID_SECRET)).toBe(true)
        expect(isValidAppSecret(VALID_SECRET + 'x')).toBe(true)
    })
})
