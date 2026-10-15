import { describe, expect, it } from 'vitest'
import { checkEnvVars } from '#server/utils/health-checks'

// Deliberately a literal 32, not an import from `nuxt4:auth`'s `session-password.ts`: a db-without-auth scaffold has no such file.
const MIN_SESSION_PASSWORD_LENGTH = 32

const VALID_PASSWORD = 'a'.repeat(MIN_SESSION_PASSWORD_LENGTH)
const SHORT_PASSWORD = 'a'.repeat(MIN_SESSION_PASSWORD_LENGTH - 1)
const DB_URL = 'postgres://user:pass@localhost:5432/app'

describe('health.get checkEnvVars (with-db)', () => {
    // `nuxt4:database` does not require `nuxt4:auth`: a db-without-auth scaffold is valid
    // and must not fail readiness over a session password nothing reads.
    it('treats an absent session config (auth not installed) as not-applicable', () => {
        expect(checkEnvVars(undefined, DB_URL)).toEqual([])
        expect(checkEnvVars(undefined, '')).toEqual(['NUXT_DATABASE_URL'])
    })

    it('reports NUXT_SESSION_PASSWORD missing when the password is empty', () => {
        expect(checkEnvVars('', DB_URL)).toEqual(['NUXT_SESSION_PASSWORD'])
    })

    it('reports NUXT_SESSION_PASSWORD missing when the password is too short (the length branch)', () => {
        expect(checkEnvVars(SHORT_PASSWORD, DB_URL)).toEqual(['NUXT_SESSION_PASSWORD'])
    })

    it('reports NUXT_DATABASE_URL missing when the database URL is empty', () => {
        expect(checkEnvVars(VALID_PASSWORD, '')).toEqual(['NUXT_DATABASE_URL'])
    })

    it('reports both when both are missing/invalid', () => {
        expect(checkEnvVars('', '')).toEqual(['NUXT_DATABASE_URL', 'NUXT_SESSION_PASSWORD'])
    })

    it('reports nothing missing once both are valid', () => {
        expect(checkEnvVars(VALID_PASSWORD, DB_URL)).toEqual([])
    })

    it('never reports the legacy NUXT_AUTH_SECRET name', () => {
        expect(checkEnvVars('', '')).not.toContain('NUXT_AUTH_SECRET')
    })
})
