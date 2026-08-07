import { describe, expect, it } from 'vitest'
import { checkEnvVars } from '#server/utils/health-checks'

// Deliberately a literal 32, not an import from `nuxt4:auth`'s `session-password.ts`: this env-only variant only ships when `nuxt4:auth` isn't installed.
// See `health-checks.ts`'s doc comment for why; this test file must stay self-contained too.
const MIN_SESSION_PASSWORD_LENGTH = 32
const VALID_PASSWORD = 'a'.repeat(MIN_SESSION_PASSWORD_LENGTH)
const SHORT_PASSWORD = 'a'.repeat(MIN_SESSION_PASSWORD_LENGTH - 1)

describe('health.get checkEnvVars (env-only)', () => {
    it('reports NUXT_SESSION_PASSWORD missing when the password is empty', () => {
        expect(checkEnvVars('')).toEqual(['NUXT_SESSION_PASSWORD'])
    })

    it('reports NUXT_SESSION_PASSWORD missing when the password is too short (the length branch)', () => {
        expect(checkEnvVars(SHORT_PASSWORD)).toEqual(['NUXT_SESSION_PASSWORD'])
    })

    it('reports nothing missing once the password meets the minimum length', () => {
        expect(checkEnvVars(VALID_PASSWORD)).toEqual([])
    })

    it('never reports the legacy NUXT_AUTH_SECRET name', () => {
        expect(checkEnvVars('')).not.toContain('NUXT_AUTH_SECRET')
        expect(checkEnvVars(SHORT_PASSWORD)).not.toContain('NUXT_AUTH_SECRET')
    })
})
