import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { InstalledFeatureRecord } from '@battlestack/core'
import { essentialsFeature } from '../src/features/essentials.js'
import { mockRunContext } from './test-utils.js'

const TEMPLATE_PUBLIC = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'templates',
    'essentials',
    'public',
)

const ICONS = ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png'] as const

let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-icons-test-'))
    // What `nuxi init --template minimal` leaves behind, minus the parts this feature
    // does not read.
    await writeFile(path.join(projectDir, 'nuxt.config.ts'), 'export default defineNuxtConfig({})\n', 'utf8')
    await writeFile(path.join(projectDir, 'package.json'), '{\n  "name": "demo"\n}\n', 'utf8')
})

afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
})

function ctx() {
    return mockRunContext({
        projectDir,
        enabledFeatures: new Set(['nuxt4:essentials']),
        state: { packageManager: 'pnpm' },
    })
}

const readNuxtConfig = (): Promise<string> =>
    readFile(path.join(projectDir, 'nuxt.config.ts'), 'utf8')

const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex')

describe('essentialsFeature: default favicon and app icons', () => {
    it('emits all three icons byte-identical to the shipped templates', async () => {
        await essentialsFeature.execute(ctx())

        for (const icon of ICONS) {
            const emitted = await readFile(path.join(projectDir, 'public', icon))
            const shipped = await readFile(path.join(TEMPLATE_PUBLIC, icon))
            // Byte equality, not mere existence: a mangled binary copy still "exists".
            expect(sha256(emitted), icon).toBe(sha256(shipped))
        }
    })

    it('overwrites the Nuxt-logo favicon that nuxi init leaves behind', async () => {
        const nuxiDefault = Buffer.from([0x00, 0x00, 0x01, 0x00, 0xde, 0xad, 0xbe, 0xef])
        await mkdir(path.join(projectDir, 'public'), { recursive: true })
        await writeFile(path.join(projectDir, 'public', 'favicon.ico'), nuxiDefault)

        await essentialsFeature.execute(ctx())

        const emitted = await readFile(path.join(projectDir, 'public', 'favicon.ico'))
        expect(emitted.equals(nuxiDefault)).toBe(false)
    })

    it('points app.head.link at all three icons', async () => {
        await essentialsFeature.execute(ctx())
        const cfg = await readNuxtConfig()

        // Quote style is left to the scaffold's eslint format pass, so match on values.
        expect(cfg).toMatch(/href:\s*["']\/favicon\.svg["']/)
        expect(cfg).toMatch(/href:\s*["']\/favicon\.ico["']/)
        expect(cfg).toMatch(/href:\s*["']\/apple-touch-icon\.png["']/)
        expect(cfg).toMatch(/rel:\s*["']apple-touch-icon["']/)
        // `icon-pack/head.html` lists the .ico first, for browsers that take the first
        // entry they recognise rather than reading `type`.
        expect(cfg.indexOf('/favicon.ico')).toBeLessThan(cfg.indexOf('/favicon.svg'))
    })

    it('sets the pack theme-color', async () => {
        await essentialsFeature.execute(ctx())
        const cfg = await readNuxtConfig()

        expect(cfg).toMatch(/name:\s*["']theme-color["']/)
        expect(cfg).toMatch(/content:\s*["']#0D1520["']/)
    })

    it('does not add a second manifest link: nuxt4:pwa owns the manifest', async () => {
        await essentialsFeature.execute(ctx())
        expect(await readNuxtConfig()).not.toMatch(/rel:\s*["']manifest["']/)
    })

    it('does not duplicate link entries when run twice (pull re-runs this)', async () => {
        await essentialsFeature.execute(ctx())
        await essentialsFeature.execute(ctx())

        const cfg = await readNuxtConfig()
        expect(cfg.match(/\/favicon\.svg/g)).toHaveLength(1)
        expect(cfg.match(/\/apple-touch-icon\.png/g)).toHaveLength(1)
        expect(cfg.match(/theme-color/g)).toHaveLength(1)
    })

    it('preserves a link the project added itself', async () => {
        await writeFile(
            path.join(projectDir, 'nuxt.config.ts'),
            "export default defineNuxtConfig({\n    app: { head: { link: [{ rel: 'manifest', href: '/site.webmanifest' }] } },\n})\n",
            'utf8',
        )
        await essentialsFeature.execute(ctx())

        const cfg = await readNuxtConfig()
        expect(cfg).toContain('/site.webmanifest')
        expect(cfg).toMatch(/href:\s*["']\/favicon\.svg["']/)
    })
})

describe('essentialsFeature: icon ownership', () => {
    it('claims nothing before the feature has recorded anything', () => {
        // The bug this guards: claiming a path the feature has not written makes
        // `classifyForUpdate` return `owned` before it ever tests `!exists(dest)`, so `pull`
        // silently skips writing an icon that is not there while `wireIcons` still adds the
        // `<link>`. A project scaffolded before the icons shipped is exactly that case.
        expect(essentialsFeature.structuralFiles?.(ctx()) ?? []).toEqual([])
    })

    it('claims exactly the three icons once they are recorded', async () => {
        const c = ctx()
        await essentialsFeature.execute(c)

        expect(essentialsFeature.structuralFiles?.(c) ?? []).toEqual([
            path.join('public', 'favicon.ico'),
            path.join('public', 'favicon.svg'),
            path.join('public', 'apple-touch-icon.png'),
        ])
    })

    it('claims paths that match the manifest keys the feature actually records', async () => {
        const c = ctx()
        await essentialsFeature.execute(c)
        const recorded = Object.keys(c.state['files:nuxt4:essentials'] as Record<string, string>)

        // The ownership check is an exact string match against these keys, and they are
        // built with `path.join`. A posix literal in `structuralFiles()` matches on Linux
        // and silently misses on Windows, letting `pull` overwrite client branding.
        for (const owned of essentialsFeature.structuralFiles?.(c) ?? []) {
            expect(recorded, `${owned} is not a key this feature records`).toContain(owned)
        }
    })

    it('does NOT claim robots.txt: that one stays tracked and updatable', async () => {
        const c = ctx()
        await essentialsFeature.execute(c)
        expect(essentialsFeature.structuralFiles?.(c) ?? [])
            .not.toContain(path.join('public', 'robots.txt'))
    })

    it('leaves a project-replaced icon alone on update', async () => {
        const c = ctx()
        await essentialsFeature.execute(c)

        const owned = essentialsFeature.structuralFiles?.(c) ?? []
        const rel = owned.find((f) => f.endsWith('favicon.svg'))!
        const clientBranding = '<svg xmlns="http://www.w3.org/2000/svg"><!-- client logo --></svg>\n'
        await writeFile(path.join(projectDir, rel), clientBranding, 'utf8')

        const prev: InstalledFeatureRecord = {
            id: 'nuxt4:essentials',
            version: '1.1.0',
            files: {},
            ownedByUser: [...owned],
        }
        const report = await essentialsFeature.update!(c, prev)

        expect(await readFile(path.join(projectDir, rel), 'utf8')).toBe(clientBranding)
        expect(report.written).not.toContain(rel)
    })

    it('writes the icons on a pull into a project scaffolded before they shipped', async () => {
        // The pre-1.1.0 shape: the feature ran, so `nuxt.config.ts` and `package.json` exist,
        // but no icon was ever emitted or recorded. `pull` must write all three rather than
        // treat them as branding the user chose.
        const c = ctx()
        const prev: InstalledFeatureRecord = {
            id: 'nuxt4:essentials',
            version: '1.0.4',
            files: {},
            // Seeded exactly as `seedOwnedFromStructural` in `commands/pull.ts` does it. Passing
            // an empty list here instead would bypass the bug entirely and pass either way.
            ownedByUser: essentialsFeature.structuralFiles?.(c) ?? [],
        }
        const report = await essentialsFeature.update!(c, prev)

        for (const icon of ICONS) {
            const dest = path.join(projectDir, 'public', icon)
            const emitted = await readFile(dest)
            const shipped = await readFile(path.join(TEMPLATE_PUBLIC, icon))
            expect(sha256(emitted), `${icon} was not written`).toBe(sha256(shipped))
            expect(report.written, `${icon} missing from the report`)
                .toContain(path.join('public', icon))
        }
        // The `<link>` tags and the files must arrive together; the bug shipped the tags alone.
        const cfg = await readNuxtConfig()
        expect(cfg).toMatch(/href:\s*["']\/apple-touch-icon\.png["']/)
    })
})
