import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    BattlestackRegistries,
    silentLoader,
    STAGE,
    type CommandContext,
    type Feature,
    type ParsedArgs,
} from '@battlestack/core'

const { gatedPms } = vi.hoisted(() => ({ gatedPms: [] as string[] }))

/** Records the pm preflight gates on, then aborts before the scaffold runs. */
vi.mock('@battlestack/core/utils/preflight.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@battlestack/core/utils/preflight.js')>()
    return {
        ...actual,
        runEnvPreflight: async (input: { pm: string }) => {
            gatedPms.push(input.pm)
            return []
        },
        enforcePreflight: () => {
            throw new Error('preflight-reached')
        },
    }
})

const { createCommand } = await import('../src/commands/create.js')

const origin = { plugin: 'preset-nuxt', namespace: 'nuxt' }

const fakeFeature = (id: string): Feature => ({
    id,
    version: '0.1.0',
    label: id,
    stage: STAGE.STYLING,
    async execute() {},
})

function makeRegistries(): BattlestackRegistries {
    const r = new BattlestackRegistries()
    r.frameworks.register({ id: 'nuxt', label: 'Nuxt', supportedFeatures: [] }, origin)
    r.features.register(fakeFeature('nuxt4:extra'), origin)
    r.templates.register(
        {
            id: 'nuxt4-minimal',
            label: 'Nuxt (minimal)',
            framework: 'nuxt',
            requiredFeatures: [],
            optionalFeatures: ['nuxt4:extra'],
        },
        origin,
    )
    return r
}

function makeArgs(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
    return {
        positionals: [],
        force: false,
        overwrite: false,
        yes: true,
        skipInstall: false,
        debug: false,
        dryRun: true,
        help: false,
        version: false,
        scaffold: false,
        seed: false,
        deep: false,
        verbose: false,
        volumes: false,
        browser: true,
        skills: true,
        format: true,
        skillsOnly: false,
        passthrough: [],
        framework: 'nuxt',
        template: 'nuxt4-minimal',
        ...overrides,
    }
}

function ctx(args: ParsedArgs, registries: BattlestackRegistries): CommandContext {
    return { args: [], parsed: args, loader: silentLoader(), registries }
}

/** Runs createCommand as far as preflight and returns the pm it gated on. */
async function pmGatedBy(args: ParsedArgs): Promise<string | undefined> {
    gatedPms.length = 0
    await expect(createCommand(ctx(args, makeRegistries()))).rejects.toThrow('preflight-reached')
    return gatedPms.at(-1)
}

describe('preflight gates the pm the scaffold will actually use', () => {
    let dir: string
    const originalUserAgent = process.env.npm_config_user_agent

    beforeEach(async () => {
        dir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-pm-wiring-'))
    })

    afterEach(async () => {
        if (originalUserAgent === undefined) delete process.env.npm_config_user_agent
        else process.env.npm_config_user_agent = originalUserAgent
        await rm(dir, { recursive: true, force: true })
    })

    it('gates pnpm under an npx user agent, not the detected npm', async () => {
        process.env.npm_config_user_agent = 'npm/11.16.0 node/v24.18.0 darwin arm64 workspaces/false'
        expect(await pmGatedBy(makeArgs({ cwd: dir }))).toBe('pnpm')
    })

    it('gates pnpm under a bun user agent, not the detected bun', async () => {
        process.env.npm_config_user_agent = 'bun/1.3.0 npm/? node/v24.18.0 darwin arm64'
        expect(await pmGatedBy(makeArgs({ cwd: dir }))).toBe('pnpm')
    })

    it('gates the pm named by --pm', async () => {
        process.env.npm_config_user_agent = 'npm/11.16.0 node/v24.18.0 darwin arm64 workspaces/false'
        expect(await pmGatedBy(makeArgs({ cwd: dir, packageManager: 'npm' }))).toBe('npm')
    })
})
