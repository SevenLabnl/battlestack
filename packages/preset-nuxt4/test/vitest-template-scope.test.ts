import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `nuxt4:vitest` is in every template, `nuxt4:auth` is not (nuxt4-minimal), so a test
 * that needs auth ships with auth. Otherwise a fresh project without auth is never green.
 */

const templates = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates')

async function testFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true })
    return entries
        .filter((e) => e.isFile() && e.name.endsWith('.test.ts'))
        .map((e) => path.join(e.parentPath, e.name))
}

describe('nuxt4:vitest ships no test that depends on nuxt4:auth', () => {
    it('no vitest template test calls an auth endpoint or logs in', async () => {
        const offenders: string[] = []
        for (const file of await testFiles(path.join(templates, 'vitest'))) {
            const src = await readFile(file, 'utf8')
            if (/\/api\/auth\/|loginAsAdmin/.test(src)) offenders.push(path.relative(templates, file))
        }
        expect(offenders).toEqual([])
    })

    it('the auth e2e test ships with nuxt4:auth', async () => {
        const src = await readFile(path.join(templates, 'auth/test/e2e/api/auth.test.ts'), 'utf8')
        expect(src).toContain('/api/auth/me')
    })
})
