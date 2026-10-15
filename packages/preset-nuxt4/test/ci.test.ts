import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run } from '@battlestack/core/utils/run.js'
import { ciFeature } from '../src/features/ci.js'
import type { PackageManager } from '@battlestack/core'
import { mockRunContext } from './test-utils.js'

vi.mock('@battlestack/core/utils/run.js', () => ({ run: vi.fn(async () => ({ stdout: '', stderr: '' })) }))

let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-ci-test-'))
    await writeFile(path.join(projectDir, 'package.json'), '{}')
})

afterEach(async () => {
    vi.mocked(run).mockClear()
    await rm(projectDir, { recursive: true, force: true })
})

function ctx(pm: PackageManager = 'pnpm') {
    return mockRunContext({
        projectDir,
        enabledFeatures: new Set(['shared:ci']),
        state: { packageManager: pm },
    })
}

describe('ciFeature', () => {
    it('declares lefthook + vue-tsc as dev deps', () => {
        const deps = ciFeature.collectDeps!(ctx())
        expect(deps?.dev).toContain('lefthook')
        expect(deps?.dev).toContain('vue-tsc')
    })

    it('emits lefthook.yml with the pnpm exec binding', async () => {
        await ciFeature.execute(ctx('pnpm'))
        const content = await readFile(path.join(projectDir, 'lefthook.yml'), 'utf8')
        expect(content.length).toBeGreaterThan(0)
        expect(content).not.toContain('__PM_EXEC__')
        expect(content).toContain('pnpm exec')
    })

    it('renders bunx for bun and npx for npm', async () => {
        await ciFeature.execute(ctx('bun'))
        let content = await readFile(path.join(projectDir, 'lefthook.yml'), 'utf8')
        expect(content).toContain('bunx')

        await ciFeature.execute(ctx('npm'))
        content = await readFile(path.join(projectDir, 'lefthook.yml'), 'utf8')
        expect(content).toContain('npx')
    })

    it('installs the hooks from a prepare script', async () => {
        await ciFeature.execute(ctx())
        const pkg = JSON.parse(await readFile(path.join(projectDir, 'package.json'), 'utf8'))
        expect(pkg.scripts.prepare).toBe('lefthook install || exit 0')
    })

    it('keeps an existing prepare script and notes the missing hook install', async () => {
        await writeFile(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { prepare: 'husky' } }))
        const report = await ciFeature.update!(ctx(), null)
        const pkg = JSON.parse(await readFile(path.join(projectDir, 'package.json'), 'utf8'))
        expect(pkg.scripts.prepare).toBe('husky')
        expect(report.notes[0]).toContain('lefthook install')
        expect(run).not.toHaveBeenCalled()
    })

    it('update() runs prepare, which pull\'s up-to-date install skips', async () => {
        await ciFeature.update!(ctx(), null)
        expect(run).toHaveBeenCalledWith('pnpm', ['run', 'prepare'], expect.objectContaining({ cwd: projectDir }))
    })

    it('update() reports lefthook.yml as written', async () => {
        const report = await ciFeature.update!(ctx(), null)
        expect(report.written).toEqual(['lefthook.yml'])
    })

    it('collectDocs documents the hook setup', () => {
        const docs = ciFeature.collectDocs!(ctx())
        expect(docs?.[0].heading).toBe('Git hooks')
        expect(docs?.[0].body).toContain('lefthook')
    })
})
