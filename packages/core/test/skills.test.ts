import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dlxArgs, dlxBinary } from '../src/utils/package-manager.js'
import type { RunContext } from '../src/types/run-context.js'

const runMock = vi.hoisted(() => vi.fn(async () => ({ stdout: '', stderr: '', code: 0 })))
vi.mock('../src/utils/run.js', () => ({ run: runMock }))

// Keep dlxArgs/dlxBinary real; stub only resolveProjectPM, whose PATH detection is
// non-deterministic in a vitest worker.
vi.mock('../src/utils/package-manager.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/utils/package-manager.js')>()
    return { ...actual, resolveProjectPM: vi.fn(async (o: { fallback?: string }) => o?.fallback ?? 'pnpm') }
})

const { installSkills, collectSkillSources } = await import('../src/utils/skills.js')
const { BattlestackRegistries } = await import('../src/registry.js')
const { STAGE } = await import('../src/constants/stages.js')

const origin = { plugin: 'test-plugin', namespace: 'test' }

let projectDir: string

beforeEach(async () => {
    runMock.mockClear()
    runMock.mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-skills-test-'))
    // No `packageManager` field → resolveProjectPM falls back to ctx.state.
    await writeFile(path.join(projectDir, 'package.json'), '{"name":"demo"}\n', 'utf8')
})

afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
})

function ctx(state: Record<string, unknown> = {}, enabled: string[] = []): RunContext {
    return {
        projectName: 'demo',
        projectDir,
        framework: { id: 'nuxt' },
        template: { id: 't' },
        enabledFeatures: new Set(enabled),
        state: { packageManager: 'pnpm', ...state },
        debug: false,
        dryRun: false,
    } as unknown as RunContext
}

describe('installSkills', () => {
    it('is package-manager-agnostic: runs through the project PM dlx, not hardcoded pnpm', async () => {
        await installSkills(ctx({ packageManager: 'bun' }), ['mastra-ai/skills'])
        expect(runMock).toHaveBeenCalledWith(
            dlxBinary('bun'),
            dlxArgs('bun', ['skills', 'add', 'mastra-ai/skills']),
            { cwd: projectDir, inherit: true },
        )
    })

    it('is best-effort: a failing `skills add` warns but does not throw', async () => {
        runMock.mockRejectedValueOnce(new Error('registry down'))
        await expect(installSkills(ctx(), ['mastra-ai/skills'])).resolves.toBeUndefined()
    })

    it('re-runs even when the skill already exists: `skills add` is the update/cleanup path', async () => {
        await mkdir(path.join(projectDir, '.claude', 'skills', 'mastra-ai'), { recursive: true })
        await installSkills(ctx(), ['mastra-ai/skills'])
        expect(runMock).toHaveBeenCalledTimes(1)
    })

    it('does nothing on --dry-run or --skip-install', async () => {
        await installSkills(ctx({}, []), ['mastra-ai/skills']) // baseline: would call
        expect(runMock).toHaveBeenCalledTimes(1)
        runMock.mockClear()
        await installSkills({ ...ctx(), dryRun: true } as RunContext, ['mastra-ai/skills'])
        await installSkills(ctx({ skipInstall: true }), ['mastra-ai/skills'])
        expect(runMock).not.toHaveBeenCalled()
    })

    it('dedupes sources', async () => {
        await installSkills(ctx(), ['a/skill', 'a/skill'])
        expect(runMock).toHaveBeenCalledTimes(1)
    })
})

describe('collectSkillSources', () => {
    const FAKE = {
        id: 'test:skilled',
        version: '1.0.0',
        label: 'fake',
        frameworks: ['nuxt'] as const,
        stage: STAGE.AI_CORE,
        collectSkills: () => ['acme/widget'],
        execute: async () => {},
    }

    it('aggregates collectSkills only from ENABLED features', () => {
        const registries = new BattlestackRegistries()
        registries.features.register(FAKE as never, origin)
        expect(collectSkillSources(ctx({}, ['test:skilled']), registries)).toEqual(['acme/widget'])
        expect(collectSkillSources(ctx({}, []), registries)).toEqual([])
    })
})
