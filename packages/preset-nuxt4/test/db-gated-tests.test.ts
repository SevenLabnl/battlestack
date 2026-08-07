import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `database/client.ts` throws from its MODULE BODY without `NUXT_DATABASE_URL`, so a static
 * import kills an emitted test file before its `skipIf` runs. Invisible until `.env` is gone.
 */
const TEMPLATES = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'templates',
)

const RATE_LIMIT_TEST = path.join(
    TEMPLATES, 'auth', 'test', 'unit', 'rate-limit.test.ts',
)

const source = (): Promise<string> => readFile(RATE_LIMIT_TEST, 'utf8')

describe('emitted DB-gated unit tests survive a fork (no .env, no database)', () => {
    it('never statically imports the database client', async () => {
        const src = await source()
        // The dynamic `await import(...)` inside the gate is the point of the fix, so
        // match only the static module-scope statement.
        expect(src).not.toMatch(/^import\s[^\n]*from '#server\/database\/client'/m)
    })

    it('never statically imports a module that pulls in the database client', async () => {
        const src = await source()
        // `rate-limit` imports the client, so importing it statically is equally fatal.
        expect(src).not.toMatch(/^import\s[^\n]*from '#server\/utils\/rate-limit'/m)
    })

    it('loads both modules lazily, inside the reachability gate', async () => {
        const src = await source()
        const gate = src.slice(src.indexOf('async function isDbUp'))
        expect(gate).toContain("await import('#server/database/client')")
        expect(gate).toContain("await import('#server/utils/rate-limit')")
    })

    it('still gates every DB-touching assertion on the probe', async () => {
        const src = await source()
        // The lazy import is no excuse to drop the skip: without `skipIf` these fail
        // rather than skip when Postgres is absent, which is the same red build.
        expect(src).toMatch(/it\.skipIf\(!dbUp\)/)
    })
})
