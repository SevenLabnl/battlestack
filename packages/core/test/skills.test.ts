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

const { installSkills, collectSkillSources, nonInteractiveGitEnv } = await import('../src/utils/skills.js')
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
            dlxArgs('bun', ['skills', 'add', 'mastra-ai/skills', '--yes', '--agent', 'claude-code']),
            { cwd: projectDir, inherit: true, env: expect.objectContaining({ GIT_TERMINAL_PROMPT: '0' }) },
        )
    })

    // An unknown github.com host key or a credential prompt otherwise hangs the scaffold behind the spinner.
    it('runs `skills add` with git and ssh unable to prompt', async () => {
        await installSkills(ctx(), ['owner/repo'])
        const options = (runMock.mock.calls[0] as unknown[])[2] as { env: Record<string, string> }
        expect(options.env.GIT_TERMINAL_PROMPT).toBe('0')
        expect(options.env.GIT_SSH_COMMAND).toMatch(/ -o BatchMode=yes$/)
    })

    // Without `--agent` the installer writes to every agent it detects, so third-party skill code
    // lands in editor directories the project never configured, and eslint then lints it.
    it('installs only for the configured AI tool', async () => {
        await installSkills(ctx({ aiTool: 'cursor' }), ['mastra-ai/skills'])
        expect(runMock).toHaveBeenCalledWith(
            expect.anything(),
            expect.arrayContaining(['--agent', 'cursor']),
            expect.anything(),
        )
    })

    it('falls back to claude-code when no AI tool is recorded or the value is unknown', async () => {
        for (const aiTool of [undefined, 'not-a-tool']) {
            runMock.mockClear()
            await installSkills(ctx({ aiTool }), ['mastra-ai/skills'])
            expect(runMock).toHaveBeenCalledWith(
                expect.anything(),
                expect.arrayContaining(['--agent', 'claude-code']),
                expect.anything(),
            )
        }
    })

    // `skills add` prompts for confirmation on a TTY, which stalls an unattended scaffold or pull.
    it('runs non-interactively and project-local: --yes, never --global', async () => {
        await installSkills(ctx(), ['mastra-ai/skills'])
        expect(runMock).toHaveBeenCalledWith(
            dlxBinary('pnpm'),
            expect.arrayContaining(['--yes']),
            expect.objectContaining({ cwd: projectDir }),
        )
        for (const global of ['--global', '-g']) {
            expect(runMock).not.toHaveBeenCalledWith(
                expect.anything(),
                expect.arrayContaining([global]),
                expect.anything(),
            )
        }
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

describe('nonInteractiveGitEnv', () => {
    // Isolated from the developer's own git config: an empty global config, no system config.
    async function gitEnv(extra: Record<string, string>, globalConfig = ''): Promise<NodeJS.ProcessEnv> {
        const config = path.join(projectDir, 'gitconfig')
        await writeFile(config, globalConfig, 'utf8')
        return { PATH: process.env.PATH, HOME: projectDir, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1', ...extra }
    }

    it('defaults to plain ssh in batch mode, the binary git would pick anyway', async () => {
        const env = await nonInteractiveGitEnv(projectDir, await gitEnv({}))
        expect(env).toEqual({ GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' })
    })

    it('appends to GIT_SSH_COMMAND instead of replacing it', async () => {
        const env = await nonInteractiveGitEnv(projectDir, await gitEnv({ GIT_SSH_COMMAND: 'ssh -i ~/.ssh/deploy' }))
        expect(env.GIT_SSH_COMMAND).toBe('ssh -i ~/.ssh/deploy -o BatchMode=yes')
    })

    it('appends to core.sshCommand, e.g. a 1Password or Windows OpenSSH binary', async () => {
        const env = await nonInteractiveGitEnv(
            projectDir,
            await gitEnv({}, '[core]\n\tsshCommand = C:/Windows/System32/OpenSSH/ssh.exe\n'),
        )
        expect(env.GIT_SSH_COMMAND).toBe('C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes')
    })

    it('leaves GIT_SSH (plink and friends) alone', async () => {
        const env = await nonInteractiveGitEnv(projectDir, await gitEnv({ GIT_SSH: 'plink.exe' }))
        expect(env).toEqual({ GIT_TERMINAL_PROMPT: '0' })
    })
})
