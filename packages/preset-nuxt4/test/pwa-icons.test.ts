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

/** Exactly what `nuxt4:pwa` 1.0.2 wrote, so the repair path is tested against the real shape. */
const LEGACY_CONFIG = `export default defineNuxtConfig({
    pwa: {
        registerType: 'autoUpdate',
        manifest: {
            name: 'demo',
            short_name: 'demo',
            theme_color: '#3b82f6',
            background_color: '#ffffff',
            display: 'standalone',
            icons: [
                { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
                {
                    src: '/icon-512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'maskable',
                },
            ],
        },
        workbox: {
            navigateFallback: '/',
            globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
        },
        devOptions: { enabled: false },
    },
})
`

describe('pwaFeature: updating a manifest an earlier version wrote', () => {
    const prev = { id: 'nuxt4:pwa', version: '1.0.2', files: {}, ownedByUser: [] }

    beforeEach(async () => {
        await writeFile(path.join(projectDir, 'nuxt.config.ts'), LEGACY_CONFIG, 'utf8')
    })

    it('repoints the maskable entry at the dedicated file', async () => {
        // The bug this guards: a whole-object `cfg.pwa ??=` skips every corrected value when the
        // key already exists, so the new maskable PNGs get written and nothing references them.
        await pwaFeature.update!(ctx(), prev)
        const cfg = await readFile(path.join(projectDir, 'nuxt.config.ts'), 'utf8')

        expect(cfg).toMatch(/src:\s*["']\/icon-maskable-512\.png["']/)
        expect(cfg).toMatch(/src:\s*["']\/icon-maskable-192\.png["']/)
        // No maskable entry may still point at a plain icon.
        const maskableBlocks = cfg.split('purpose').slice(0, -1)
        for (const block of maskableBlocks) {
            const lastSrc = block.lastIndexOf('src:')
            expect(block.slice(lastSrc)).toMatch(/icon-maskable-/)
        }
    })

    it('updates colours that still hold the pre-icon-pack defaults', async () => {
        await pwaFeature.update!(ctx(), prev)
        const cfg = await readFile(path.join(projectDir, 'nuxt.config.ts'), 'utf8')

        expect(cfg).toMatch(/theme_color:\s*["']#0D1520["']/)
        expect(cfg).toMatch(/background_color:\s*["']#0A121E["']/)
        expect(cfg).not.toContain('#3b82f6')
    })

    it('leaves colours a project chose for itself alone', async () => {
        await writeFile(
            path.join(projectDir, 'nuxt.config.ts'),
            LEGACY_CONFIG.replace("'#3b82f6'", "'#ff0000'").replace("'#ffffff'", "'#00ff00'"),
            'utf8',
        )
        await pwaFeature.update!(ctx(), prev)
        const cfg = await readFile(path.join(projectDir, 'nuxt.config.ts'), 'utf8')

        expect(cfg).toContain('#ff0000')
        expect(cfg).toContain('#00ff00')
    })

    it('tells the user what it changed', async () => {
        const report = await pwaFeature.update!(ctx(), prev)
        // Silence was the original failure: files written, manifest stale, notes empty.
        expect(report.notes.join('\n')).toMatch(/maskable/)
    })

    it('is idempotent across repeated pulls', async () => {
        await pwaFeature.update!(ctx(), prev)
        const once = await readFile(path.join(projectDir, 'nuxt.config.ts'), 'utf8')
        const report = await pwaFeature.update!(ctx(), prev)
        const twice = await readFile(path.join(projectDir, 'nuxt.config.ts'), 'utf8')

        expect(twice).toBe(once)
        expect(report.notes).toEqual([])
        expect(twice.match(/icon-maskable-192/g)).toHaveLength(1)
    })
})

