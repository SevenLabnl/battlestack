import { describe, expect, it } from 'vitest'
import {
    assertValidSessionPasswordUnlessDev,
    isValidSessionPassword,
    MIN_SESSION_PASSWORD_LENGTH,
} from '#server/utils/session-password'

const VALID_PASSWORD = 'a'.repeat(MIN_SESSION_PASSWORD_LENGTH)
const SHORT_PASSWORD = 'a'.repeat(MIN_SESSION_PASSWORD_LENGTH - 1)

describe('assertValidSessionPasswordUnlessDev', () => {
    it('throws when not a dev build and the password is absent', () => {
        expect(() => assertValidSessionPasswordUnlessDev(false, '')).toThrow(
            /NUXT_SESSION_PASSWORD is not set/,
        )
    })

    it('throws when not a dev build and the password is too short', () => {
        expect(() => assertValidSessionPasswordUnlessDev(false, SHORT_PASSWORD)).toThrow(
            /NUXT_SESSION_PASSWORD is too short/,
        )
    })

    it('does not throw when not a dev build but the password is valid', () => {
        expect(() => assertValidSessionPasswordUnlessDev(false, VALID_PASSWORD)).not.toThrow()
    })

    it('does not throw on a dev build, even absent or short: the ONE case that skips validation', () => {
        expect(() => assertValidSessionPasswordUnlessDev(true, '')).not.toThrow()
        expect(() => assertValidSessionPasswordUnlessDev(true, SHORT_PASSWORD)).not.toThrow()
    })

    it('mentions the exact env var and the same-value-across-instances requirement', () => {
        try {
            assertValidSessionPasswordUnlessDev(false, '')
            expect.fail('expected assertValidSessionPasswordUnlessDev to throw')
        } catch (err) {
            const message = (err as Error).message
            expect(message).toContain('NUXT_SESSION_PASSWORD')
            expect(message).toContain('same value on every running instance')
        }
    })

    // Pinned explicitly, not just `true`/`false`: restructured to ask "is this production" instead of
    // "is this dev", the guard would skip on anything non-boolean, the wrong direction for a security boundary.
    it('validates (fails closed) for anything that is not exactly `true`', () => {
        // @ts-expect-error deliberately non-boolean, proving the guard does not short-circuit on a truthy-but-wrong value.
        expect(() => assertValidSessionPasswordUnlessDev(1, '')).toThrow(/NUXT_SESSION_PASSWORD/)
        // @ts-expect-error same, for `undefined`.
        expect(() => assertValidSessionPasswordUnlessDev(undefined, '')).toThrow(/NUXT_SESSION_PASSWORD/)
    })
})

describe('isValidSessionPassword', () => {
    it('rejects anything shorter than MIN_SESSION_PASSWORD_LENGTH', () => {
        expect(isValidSessionPassword(SHORT_PASSWORD)).toBe(false)
        expect(isValidSessionPassword('')).toBe(false)
    })

    it('accepts exactly MIN_SESSION_PASSWORD_LENGTH characters and above', () => {
        expect(isValidSessionPassword(VALID_PASSWORD)).toBe(true)
        expect(isValidSessionPassword(VALID_PASSWORD + 'x')).toBe(true)
    })
})
