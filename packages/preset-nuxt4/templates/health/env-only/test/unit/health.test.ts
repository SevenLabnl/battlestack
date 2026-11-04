import { describe, expect, it } from 'vitest'
import { checkEnvVars } from '#server/utils/health-checks'

// Deliberately a literal 32, not an import from `nuxt4:auth`'s `app-secret.ts`: this env-only variant only ships when `nuxt4:auth` isn't installed.
// See `health-checks.ts`'s doc comment for why; this test file must stay self-contained too.
const MIN_APP_SECRET_LENGTH = 32
const VALID_SECRET = 'a'.repeat(MIN_APP_SECRET_LENGTH)
const SHORT_SECRET = 'a'.repeat(MIN_APP_SECRET_LENGTH - 1)

describe('health.get checkEnvVars (env-only)', () => {
    // `nuxt4:auth` requires `nuxt4:database` and this variant ships without the database,
    // so auth, and with it the app secret, can never be installed here. Treating absence
    // as missing would make readiness unsatisfiable in every env-only scaffold.
    it('treats an absent session config (auth not installed) as not-applicable', () => {
        expect(checkEnvVars(undefined)).toEqual([])
    })

    it('reports NUXT_APP_SECRET missing when the secret is empty', () => {
        expect(checkEnvVars('')).toEqual(['NUXT_APP_SECRET'])
    })

    it('reports NUXT_APP_SECRET missing when the secret is too short (the length branch)', () => {
        expect(checkEnvVars(SHORT_SECRET)).toEqual(['NUXT_APP_SECRET'])
    })

    it('reports nothing missing once the secret meets the minimum length', () => {
        expect(checkEnvVars(VALID_SECRET)).toEqual([])
    })

    it('never reports the legacy NUXT_AUTH_SECRET name', () => {
        expect(checkEnvVars('')).not.toContain('NUXT_AUTH_SECRET')
        expect(checkEnvVars(SHORT_SECRET)).not.toContain('NUXT_AUTH_SECRET')
    })
})
