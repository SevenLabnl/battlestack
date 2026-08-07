import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The minimum session-secret length lives in FOUR places, three of them hand-maintained
 * copies that cannot import the constant, and nothing else checks that they agree.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const pkg = path.resolve(here, '..')

const AUTHORITATIVE = path.join(pkg, 'templates/auth/server/utils/session-password.ts')
const CLI_LOGIN = path.join(pkg, 'src/features/auth.ts')
const HEALTH_ENV_ONLY = path.join(pkg, 'templates/health/env-only/server/utils/health-checks.ts')
const HEALTH_WITH_DB = path.join(pkg, 'templates/health/with-db/server/utils/health-checks.ts')

/** Pull a single capture group out of a file, failing loudly if it moved. */
async function extract(file: string, re: RegExp, what: string): Promise<string> {
    const src = await readFile(file, 'utf8')
    const m = re.exec(src)
    if (!m) {
        throw new Error(
            `could not find ${what} in ${path.relative(pkg, file)}: it was refactored or removed. `
            + 'Update this test to match; do not delete the assertion, it is the only thing '
            + 'keeping these copies in sync.',
        )
    }
    return m[1]!
}

describe('minimum session-secret length is consistent across every copy', () => {
    it('the authoritative template constant is the iron-webcrypto floor', async () => {
        const value = await extract(
            AUTHORITATIVE,
            /export const MIN_SESSION_PASSWORD_LENGTH\s*=\s*(\d+)/,
            'MIN_SESSION_PASSWORD_LENGTH',
        )
        // Not just "they agree": all four could drift together to 16 and a pure
        // consistency check would stay green while every seal throws.
        expect(value).toBe('32')
    })

    it('the CLI login preflight uses the same threshold as the app it logs into', async () => {
        const authoritative = await extract(
            AUTHORITATIVE,
            /export const MIN_SESSION_PASSWORD_LENGTH\s*=\s*(\d+)/,
            'MIN_SESSION_PASSWORD_LENGTH',
        )
        const cli = await extract(
            CLI_LOGIN,
            /NUXT_SESSION_PASSWORD'\)\s*\?\?\s*''\s*\n\s*if \(secret\.length < (\d+)\)/,
            'runLogin\'s hardcoded secret-length check',
        )
        expect(cli).toBe(authoritative)
    })

    it('the env-only health check uses the same threshold', async () => {
        const authoritative = await extract(
            AUTHORITATIVE,
            /export const MIN_SESSION_PASSWORD_LENGTH\s*=\s*(\d+)/,
            'MIN_SESSION_PASSWORD_LENGTH',
        )
        const envOnly = await extract(
            HEALTH_ENV_ONLY,
            /const MIN_SESSION_PASSWORD_LENGTH\s*=\s*(\d+)/,
            'the env-only health check\'s local MIN_SESSION_PASSWORD_LENGTH',
        )
        expect(envOnly).toBe(authoritative)
    })

    it('the with-db health check still imports the constant instead of re-declaring it', async () => {
        const src = await readFile(HEALTH_WITH_DB, 'utf8')
        expect(src).toMatch(/from '#server\/utils\/session-password'/)
        // A local literal here would be a fourth copy to keep in sync by hand.
        expect(src).not.toMatch(/const MIN_SESSION_PASSWORD_LENGTH\s*=\s*\d+/)
    })
})
