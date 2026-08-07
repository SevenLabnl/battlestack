import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findBattlestackArtefacts, findStagedArtefacts, findStaleRecords } from '../src/commands/cleanup.js'
import type { ProjectManifest } from '@battlestack/core'

let tmpDir: string

beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-cleanup-test-'))
})

afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
})

const manifestWith = (files: Record<string, string>): ProjectManifest => ({
    schemaVersion: 1,
    cliVersion: '0.0.0',
    framework: 'nuxt',
    template: 'nuxt4-ai',
    packageManager: 'pnpm',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    features: [{ id: 'test:feature', version: '1.0.0', files }],
})

describe('findBattlestackArtefacts', () => {
    it('collects .battlestack.bak/.battlestack.new/.battlestack.patch recursively', async () => {
        await mkdir(path.join(tmpDir, 'app', 'pages'), { recursive: true })
        await writeFile(path.join(tmpDir, 'nuxt.config.ts.battlestack.bak'), 'x')
        await writeFile(path.join(tmpDir, 'app', 'pages', 'index.vue.battlestack.new'), 'x')
        await writeFile(path.join(tmpDir, 'app', 'layout.vue.battlestack.patch'), 'x')
        await writeFile(path.join(tmpDir, 'app', 'normal.vue'), 'x')

        const found = await findBattlestackArtefacts(tmpDir)
        expect(found.sort()).toEqual([
            path.join('app', 'layout.vue.battlestack.patch'),
            path.join('app', 'pages', 'index.vue.battlestack.new'),
            'nuxt.config.ts.battlestack.bak',
        ].sort())
    })

    it('skips node_modules, .git, and .battlestack/', async () => {
        await mkdir(path.join(tmpDir, 'node_modules', 'pkg'), { recursive: true })
        await mkdir(path.join(tmpDir, '.git'), { recursive: true })
        await mkdir(path.join(tmpDir, '.battlestack', 'pull'), { recursive: true })
        await writeFile(path.join(tmpDir, 'node_modules', 'pkg', 'x.battlestack.bak'), 'x')
        await writeFile(path.join(tmpDir, '.git', 'y.battlestack.new'), 'x')
        // staged files live under .battlestack/, collected by findStagedArtefacts
        await writeFile(path.join(tmpDir, '.battlestack', 'pull', 'a.ts.new'), 'x')

        expect(await findBattlestackArtefacts(tmpDir)).toEqual([])
    })

    it('collects bare legacy *.battlestack artefacts beside source files', async () => {
        await mkdir(path.join(tmpDir, 'server', 'utils'), { recursive: true })
        await writeFile(path.join(tmpDir, 'server', 'utils', 'email-templates.ts.battlestack'), 'x')
        await writeFile(path.join(tmpDir, 'server', 'utils', 'email-templates.ts'), 'real')

        expect(await findBattlestackArtefacts(tmpDir)).toEqual([
            path.join('server', 'utils', 'email-templates.ts.battlestack'),
        ])
    })
})

describe('findStagedArtefacts', () => {
    it('collects every file staged under .battlestack/pull/ recursively', async () => {
        await mkdir(path.join(tmpDir, '.battlestack', 'pull', 'server', 'utils'), { recursive: true })
        await writeFile(path.join(tmpDir, '.battlestack', 'pull', 'server', 'utils', 'email-templates.ts.new'), 'x')
        await writeFile(path.join(tmpDir, '.battlestack', 'pull', 'server', 'utils', 'email-templates.ts.patch'), 'x')

        const found = await findStagedArtefacts(tmpDir)
        expect(found.sort()).toEqual([
            path.join('.battlestack', 'pull', 'server', 'utils', 'email-templates.ts.new'),
            path.join('.battlestack', 'pull', 'server', 'utils', 'email-templates.ts.patch'),
        ].sort())
    })

    it('returns [] when .battlestack/pull/ does not exist', async () => {
        expect(await findStagedArtefacts(tmpDir)).toEqual([])
    })
})

describe('findStaleRecords', () => {
    it('reports records whose file is missing on disk', async () => {
        await writeFile(path.join(tmpDir, 'present.ts'), 'x')
        const manifest = manifestWith({ 'present.ts': 'hash1', 'gone.ts': 'hash2' })

        const stale = await findStaleRecords(tmpDir, manifest)
        expect(stale).toEqual([{ featureId: 'test:feature', rel: 'gone.ts' }])
    })

    it('empty when everything exists', async () => {
        await writeFile(path.join(tmpDir, 'a.ts'), 'x')
        const manifest = manifestWith({ 'a.ts': 'h' })
        expect(await findStaleRecords(tmpDir, manifest)).toEqual([])
    })
})
