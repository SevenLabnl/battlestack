import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
    BattlestackRegistries,
    CLIError,
    MANIFEST_PATH,
    silentLoader,
    STAGE,
    type CommandContext,
    type Feature,
    type ParsedArgs,
} from '@battlestack/core'
import { createCommand } from '../src/commands/create.js'
import { initCommand } from '../src/commands/init.js'

const origin = { plugin: 'preset-nuxt', namespace: 'nuxt' }

const fakeFeature = (id: string): Feature => ({
    id,
    version: '0.1.0',
    label: id,
    stage: STAGE.STYLING,
    async execute() {},
})

/** Registries with one framework, one template, and one optional feature. */
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
        yes: false,
        skipInstall: false,
        debug: false,
        dryRun: false,
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
        ...overrides,
    }
}

function ctx(args: ParsedArgs, registries: BattlestackRegistries): CommandContext {
    return { args: [], parsed: args, loader: silentLoader(), registries }
}

async function pathExists(p: string): Promise<boolean> {
    try {
        await stat(p)
        return true
    } catch {
        return false
    }
}

describe('createCommand: early arg validation (before any prompt)', () => {
    it('rejects an unknown --template', async () => {
        const r = makeRegistries()
        await expect(
            createCommand(ctx(makeArgs({ template: 'bogus' }), r)),
        ).rejects.toThrow(/Unknown template "bogus"/)
    })

    it('rejects an unknown --framework', async () => {
        const r = makeRegistries()
        await expect(
            createCommand(ctx(makeArgs({ framework: 'svelte' }), r)),
        ).rejects.toThrow(/Unknown framework "svelte"/)
    })

    it('rejects an unknown feature in --features', async () => {
        const r = makeRegistries()
        await expect(
            createCommand(ctx(makeArgs({ features: ['nope'] }), r)),
        ).rejects.toThrow(/Unknown feature "nope"/)
    })

    it('throws a CLIError (typed), not a bare Error', async () => {
        const r = makeRegistries()
        await createCommand(ctx(makeArgs({ template: 'bogus' }), r)).catch((e) => {
            expect(e).toBeInstanceOf(CLIError)
        })
    })
})

describe('initCommand', () => {
    let dir: string

    beforeEach(async () => {
        dir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-init-test-'))
    })

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true })
    })

    it('dry-run writes no manifest and returns', async () => {
        const r = makeRegistries()
        const args = makeArgs({
            cwd: dir,
            framework: 'nuxt',
            template: 'nuxt4-minimal',
            yes: true,
            dryRun: true,
        })
        await initCommand(ctx(args, r))
        expect(await pathExists(path.join(dir, MANIFEST_PATH))).toBe(false)
    })

    it('writes a manifest and refuses to overwrite without --force', async () => {
        const r = makeRegistries()
        const args = makeArgs({ cwd: dir, framework: 'nuxt', template: 'nuxt4-minimal', yes: true })
        await initCommand(ctx(args, r))
        expect(await pathExists(path.join(dir, MANIFEST_PATH))).toBe(true)

        // Second run without --force must refuse.
        await expect(initCommand(ctx(args, r))).rejects.toThrow(/already exists/)
    })
})
