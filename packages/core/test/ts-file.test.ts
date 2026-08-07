import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
    defaultObject,
    patchTsFile,
    pushUnique,
    pushUniqueAll,
    mergeShallow,
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

    it('mergeShallow preserves siblings', async () => {
        const file = mkFile(
            `export default { settings: { keep: 1 } }\n`,
        )
        await patchTsFile(file, (mod) => {
            mergeShallow(defaultObject(mod), 'settings', { added: 2 })
        })
        const out = readFileSync(file, 'utf8')
        expect(out).toMatch(/keep:\s*1/)
        expect(out).toMatch(/added:\s*2/)
    })
})
