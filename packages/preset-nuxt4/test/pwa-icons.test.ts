import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pwaFeature } from '../src/features/pwa.js'
import { mockRunContext } from './test-utils.js'

const TEMPLATE_PUBLIC = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'templates',
    'pwa',
    'public',
)

let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-pwa-icons-test-'))
    await writeFile(path.join(projectDir, 'nuxt.config.ts'), 'export default defineNuxtConfig({})\n', 'utf8')
})

afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
})

function ctx() {
    return mockRunContext({
        projectDir,
        enabledFeatures: new Set(['nuxt4:pwa']),
        state: { packageManager: 'pnpm' },
    })
}

const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex')
const readIcon = (name: string): Promise<Buffer> =>
    readFile(path.join(projectDir, 'public', name))

describe('pwaFeature: app icons', () => {
    it('emits all four icons byte-identical to the shipped templates', async () => {
        await pwaFeature.execute(ctx())

        for (const name of ['icon-192.png', 'icon-512.png', 'icon-maskable-192.png', 'icon-maskable-512.png']) {
            const emitted = await readIcon(name)
            const shipped = await readFile(path.join(TEMPLATE_PUBLIC, name))
            expect(sha256(emitted), name).toBe(sha256(shipped))
        }
    })

    it('ships a maskable drawing distinct from the plain icon', async () => {
        await pwaFeature.execute(ctx())
        // A maskable icon is full-bleed with a 66% safe zone; Android crops it to the
        // launcher's shape. Reusing the rounded-plate icon gets its corners shaved off.
        expect(sha256(await readIcon('icon-512.png')))
            .not.toBe(sha256(await readIcon('icon-maskable-512.png')))
        expect(sha256(await readIcon('icon-192.png')))
            .not.toBe(sha256(await readIcon('icon-maskable-192.png')))
    })

    it('points the manifest at the dedicated maskable files', async () => {
        await pwaFeature.execute(ctx())
        const cfg = await readFile(path.join(projectDir, 'nuxt.config.ts'), 'utf8')

        expect(cfg).toContain('/icon-maskable-192.png')
        expect(cfg).toContain('/icon-maskable-512.png')
        // The old config listed icon-512 twice, the second time as maskable.
        expect(cfg.match(/\/icon-512\.png/g)).toHaveLength(1)
    })

    it('uses the icon pack colours, matching the theme-color meta from essentials', async () => {
        await pwaFeature.execute(ctx())
        const cfg = await readFile(path.join(projectDir, 'nuxt.config.ts'), 'utf8')

        expect(cfg).toContain('#0D1520')
        expect(cfg).toContain('#0A121E')
        expect(cfg).not.toContain('#3b82f6')
    })
})
