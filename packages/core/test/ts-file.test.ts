import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
    defaultObject,
    patchTsFile,
    pushUnique,
    pushUniqueAll,
    mergeDefaults,
} from '../src/utils/ts-file.js'
import { loadFile } from 'magicast'

function mkFile(contents: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'ts-file-'))
    const file = path.join(dir, 'sample.ts')
    writeFileSync(file, contents)
    return file
}

describe('ts-file (magicast helpers)', () => {
    it('mutates a plain default export object', async () => {
        const file = mkFile(`export default { foo: 'a' }\n`)
        await patchTsFile(file, (mod) => {
            defaultObject(mod).foo = 'b'
            defaultObject(mod).bar = 1
        })
        const out = readFileSync(file, 'utf8')
        expect(out).toMatch(/foo:\s*['"]b['"]/)
        expect(out).toMatch(/bar:\s*1/)
    })

    it('mutates a wrapped default export (function-call form)', async () => {
        const file = mkFile(
            `export default defineConfig({ name: 'x' })\n`,
        )
        await patchTsFile(file, (mod) => {
            defaultObject(mod).name = 'y'
        })
        const out = readFileSync(file, 'utf8')
        expect(out).toMatch(/name:\s*['"]y['"]/)
    })

    it('survives missing trailing commas (nuxi-style)', async () => {
        const file = mkFile(
            [
                `export default defineNuxtConfig({`,
                `  modules: [`,
                `    '@nuxt/ui'`,
                `  ]`,
                `})`,
                ``,
            ].join('\n'),
        )
        await patchTsFile(file, (mod) => {
            const cfg = defaultObject(mod)
            cfg.css ||= []
            pushUnique(cfg.css, '~/assets/main.css')
        })
        // Round-trip: must reload without parse error.
        await expect(loadFile(file)).resolves.toBeDefined()
        const out = readFileSync(file, 'utf8')
        expect(out).toMatch(/css/)
        expect(out).toMatch(/~\/assets\/main\.css/)
    })

    it('pushUnique de-dupes', async () => {
        const file = mkFile(`export default { items: ['a'] }\n`)
        await patchTsFile(file, (mod) => {
            pushUnique(defaultObject(mod).items, 'a')
            pushUnique(defaultObject(mod).items, 'b')
        })
        await patchTsFile(file, (mod) => {
            pushUniqueAll(defaultObject(mod).items, ['b', 'c'])
        })
        const out = readFileSync(file, 'utf8')
        expect((out.match(/['"]a['"]/g) ?? []).length).toBe(1)
        expect((out.match(/['"]b['"]/g) ?? []).length).toBe(1)
        expect(out).toMatch(/['"]c['"]/)
    })

    it('mergeDefaults preserves siblings', async () => {
        const file = mkFile(
            `export default { settings: { keep: 1 } }\n`,
        )
        await patchTsFile(file, (mod) => {
            mergeDefaults(defaultObject(mod), 'settings', { added: 2 })
        })
        const out = readFileSync(file, 'utf8')
        expect(out).toMatch(/keep:\s*1/)
        expect(out).toMatch(/added:\s*2/)
    })

    it('mergeDefaults keeps existing values and comments, adding only missing keys', async () => {
        const file = mkFile(
            [
                `export default defineNuxtConfig({`,
                `    runtimeConfig: {`,
                `        // why this key exists`,
                `        keep: 'mine',`,
                `        health: {`,
                `            // tuned for our slow replica`,
                `            dbTimeoutMs: 5000,`,
                `        },`,
                `    },`,
                `})`,
                ``,
            ].join('\n'),
        )
        await patchTsFile(file, (mod) => {
            mergeDefaults(defaultObject(mod), 'runtimeConfig', {
                keep: '',
                added: '',
                health: { failOnDegraded: true, dbTimeoutMs: 1000 },
            })
        })
        const out = readFileSync(file, 'utf8')
        expect(out).toContain('// why this key exists')
        expect(out).toContain(`keep: 'mine'`)
        expect(out).toMatch(/added:\s*['"]{2}/)
        expect(out).toContain('// tuned for our slow replica')
        expect(out).toMatch(/dbTimeoutMs:\s*5000/)
        expect(out).toMatch(/failOnDegraded:\s*true/)
    })

    it.each([
        ['a variable', 'const cfg = {}\nexport default defineNuxtConfig({ runtimeConfig: cfg })\n'],
        ['shorthand', 'const runtimeConfig = {}\nexport default defineNuxtConfig({ runtimeConfig })\n'],
    ])('mergeDefaults names the key when it is %s', async (_, source) => {
        const file = mkFile(source)
        await expect(patchTsFile(file, (mod) => {
            mergeDefaults(defaultObject(mod), 'runtimeConfig', { added: '' }, 'nuxt.config.ts#runtimeConfig')
        })).rejects.toThrow(/nuxt\.config\.ts#runtimeConfig is not an object literal/)
    })

    it('mergeDefaults returns the nested defaults it cannot add under a non-literal value', async () => {
        const file = mkFile(
            `const baseSession = { maxAge: 60 }\nexport default { runtimeConfig: { session: baseSession, health: { a: 1 } } }\n`,
        )
        let skipped: string[] = []
        await patchTsFile(file, (mod) => {
            skipped = mergeDefaults(defaultObject(mod), 'runtimeConfig', {
                session: { sessionHeader: false },
                health: { b: 2 },
            })
        })
        expect(skipped).toEqual(['runtimeConfig.session.sessionHeader'])
        const out = readFileSync(file, 'utf8')
        expect(out).toMatch(/session:\s*baseSession/)
        expect(out).toMatch(/b:\s*2/)
    })

    it('mergeDefaults keeps an explicit null as the project\'s value', async () => {
        const file = mkFile(`export default { runtimeConfig: { smtpHost: null, session: null } }\n`)
        let skipped: string[] = []
        await patchTsFile(file, (mod) => {
            skipped = mergeDefaults(defaultObject(mod), 'runtimeConfig', {
                smtpHost: '',
                session: { sessionHeader: false },
            })
        })
        const out = readFileSync(file, 'utf8')
        expect(out).toMatch(/smtpHost:\s*null/)
        expect(out).toMatch(/session:\s*null/)
        expect(skipped).toEqual(['runtimeConfig.session.sessionHeader'])
    })
})
