import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { patchNuxtConfig } from '../src/utils/nuxt-config.js'

let dir: string

beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-nuxt-config-'))
})

afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
})

// The shape of a scaffolded config after the project's own `eslint --fix`: indent 4, keys ordered.
const LINTED = `// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({

    modules: [
        '@nuxt/eslint',
        '@nuxt/ui',
    ],
    devtools: { enabled: true },

    app: {
        head: {
            title: 'demo',
        },
    },
    compatibilityDate: '2025-07-15',
})
`

async function patched(source: string, fn: Parameters<typeof patchNuxtConfig>[1]): Promise<string> {
    await writeFile(path.join(dir, 'nuxt.config.ts'), source, 'utf8')
    await patchNuxtConfig(dir, fn)
    return readFile(path.join(dir, 'nuxt.config.ts'), 'utf8')
}

describe('patchNuxtConfig', () => {
    it('keeps a 4-space file at 4 spaces', async () => {
        const out = await patched(LINTED, (c) => c.addExtends('@battlestack/theme'))

        for (const line of LINTED.split('\n').filter((l) => l.trim() !== '')) {
            expect(out.split('\n')).toContain(line)
        }
        expect(out).not.toMatch(/^ {2}\S/m)
    })

    it('puts a new `extends` where nuxt/nuxt-config-keys-order wants it', async () => {
        const out = await patched(LINTED, (c) => c.addExtends('@battlestack/theme'))

        expect(out).toMatch(/defineNuxtConfig\(\{\n {4}extends: \['@battlestack\/theme'\],\n/)
    })

    it('keeps `appId` and `buildId` ahead of a new `extends`', async () => {
        const source = LINTED.replace('defineNuxtConfig({\n', "defineNuxtConfig({\n    appId: 'demo',\n")

        const out = await patched(source, (c) => c.addExtends('@battlestack/theme'))

        expect(out).toMatch(/appId: 'demo',\n {4}extends: \['@battlestack\/theme'\],/)
    })

    it('appends to an existing `extends` without moving it', async () => {
        const source = LINTED.replace("    compatibilityDate: '2025-07-15',\n", "    compatibilityDate: '2025-07-15',\n    extends: ['./layers/base'],\n")

        const out = await patched(source, (c) => c.addExtends('@battlestack/theme'))

        expect(out).toMatch(/compatibilityDate: '2025-07-15',\n {4}extends: \['\.\/layers\/base', '@battlestack\/theme'\],/)
    })
})
