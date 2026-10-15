import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The health endpoints are public, and a database driver's error message can name the host,
 * port or user it failed to reach. The detail goes to the server log, never into the response.
 */

const templates = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates')

describe('health endpoints keep the database error out of the response', () => {
    it.each([
        'health/with-db/server/api/health.get.ts',
        'health/with-db/server/api/health/ready.get.ts',
    ])('%s', async (rel) => {
        const src = await readFile(path.join(templates, rel), 'utf8')
        expect(src).not.toMatch(/\.message\b/)
        expect(src).not.toMatch(/\.stack\b/)
        expect(src).toMatch(/console\.error\([^)]*db check failed[^)]*, err\)/)
        expect(src).toContain(`error: 'db check failed'`)
    })

    it('boot tasks, whose failures both endpoints return as `boot.failed`', async () => {
        const src = await readFile(path.join(templates, 'database/server/utils/boot-tasks.ts'), 'utf8')
        expect(src).not.toMatch(/\.message\b/)
        expect(src).not.toMatch(/\.stack\b/)
    })
})
