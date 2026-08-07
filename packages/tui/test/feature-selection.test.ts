import prompts from 'prompts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    applyPlugin,
    defineBattlestackPlugin,
    finalizeRegistries,
    BattlestackRegistries,
    STAGE,
    type Feature,
    type ParsedArgs,
    type Provenance,
    type RunContext,
    type Template,
} from '@battlestack/core'
import {
    confirmOverwriteOwned,
    confirmProceed,
    isNonInteractive,
    resolveOptionalFeatures,
} from '../src/feature-selection.js'
import { runFeaturePromptHooks } from '../src/feature-prompts-runner.js'

// Registries are per-load instances, not a module singleton, so one shared instance per
// file mirrors how a real `BattlestackRegistries` is threaded through.
const registries = new BattlestackRegistries()
const origin: Provenance = { plugin: '@test/feature-selection', namespace: 'fptest' }

function registerOnce(feature: Feature): void {
    if (!registries.features.has(feature.id)) registries.features.register(feature, origin)
}

function makeFeature(id: string, label = id): Feature {
    return {
        id,
        label,
        version: '0.1.0',
        stage: STAGE.STYLING,
        async execute() {},
    }
}

function makeTemplate(opts: {
    id: string
    optionalFeatures: string[]
    defaultEnabledOptional?: string[]
}): Template {
    return {
        id: opts.id,
        label: opts.id,
        framework: 'fp-test-fw',
        requiredFeatures: [],
        optionalFeatures: opts.optionalFeatures,
        defaultEnabledOptional: opts.defaultEnabledOptional,
    }
}

function defaultArgs(over: Partial<ParsedArgs> = {}): ParsedArgs {
    return {
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
        positionals: [],
        passthrough: [],
        ...over,
    }
}

const origCI = process.env.CI
const origNI = process.env.CI_NON_INTERACTIVE
const origNcy = process.env.npm_config_yes

beforeEach(() => {
    delete process.env.CI
    delete process.env.CI_NON_INTERACTIVE
    delete process.env.npm_config_yes
})

afterEach(() => {
    if (origCI === undefined) delete process.env.CI
    else process.env.CI = origCI
    if (origNI === undefined) delete process.env.CI_NON_INTERACTIVE
    else process.env.CI_NON_INTERACTIVE = origNI
    if (origNcy === undefined) delete process.env.npm_config_yes
    else process.env.npm_config_yes = origNcy
})

describe('isNonInteractive', () => {
    it('returns true when --yes is set', () => {
        expect(isNonInteractive(defaultArgs({ yes: true }))).toBe(true)
    })
    it('returns true when CI=true', () => {
        process.env.CI = 'true'
        expect(isNonInteractive(defaultArgs())).toBe(true)
    })
    it('returns true when CI_NON_INTERACTIVE=1', () => {
        process.env.CI_NON_INTERACTIVE = '1'
        expect(isNonInteractive(defaultArgs())).toBe(true)
    })
    it('returns true when npm_config_yes=true', () => {
        process.env.npm_config_yes = 'true'
        expect(isNonInteractive(defaultArgs())).toBe(true)
    })
    it('returns false otherwise', () => {
        expect(isNonInteractive(defaultArgs())).toBe(false)
    })
})

describe('resolveOptionalFeatures', () => {
    it('non-interactive: returns the template default-enabled set', async () => {
        for (const id of ['fp:a', 'fp:b', 'fp:c']) registerOnce(makeFeature(id))
        const tpl = makeTemplate({
            id: 'tpl-defaults',
            optionalFeatures: ['fp:a', 'fp:b', 'fp:c'],
            defaultEnabledOptional: ['fp:a', 'fp:c'],
        })
        const out = await resolveOptionalFeatures(tpl, defaultArgs({ yes: true }), registries)
        expect([...out].sort()).toEqual(['fp:a', 'fp:c'])
    })

    it('--features short-circuits: forces id on regardless of default', async () => {
        for (const id of ['fp:d', 'fp:e']) registerOnce(makeFeature(id))
        const tpl = makeTemplate({
            id: 'tpl-force-on',
            optionalFeatures: ['fp:d', 'fp:e'],
            defaultEnabledOptional: [],
        })
        const out = await resolveOptionalFeatures(
            tpl,
            defaultArgs({ yes: true, features: ['fp:d'] }),
            registries,
        )
        expect([...out]).toEqual(['fp:d'])
    })

    it('--disable short-circuits: removes id even if in default set', async () => {
        for (const id of ['fp:f', 'fp:g']) registerOnce(makeFeature(id))
        const tpl = makeTemplate({
            id: 'tpl-force-off',
            optionalFeatures: ['fp:f', 'fp:g'],
            defaultEnabledOptional: ['fp:f', 'fp:g'],
        })
        const out = await resolveOptionalFeatures(
            tpl,
            defaultArgs({ yes: true, disable: ['fp:f'] }),
            registries,
        )
        expect([...out]).toEqual(['fp:g'])
    })

    it('--features and --disable conflict: disabled wins, warning emitted', async () => {
        registerOnce(makeFeature('fp:h'))
        const tpl = makeTemplate({
            id: 'tpl-conflict',
            optionalFeatures: ['fp:h'],
            defaultEnabledOptional: [],
        })
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        const out = await resolveOptionalFeatures(
            tpl,
            defaultArgs({ yes: true, features: ['fp:h'], disable: ['fp:h'] }),
            registries,
        )
        expect([...out]).toEqual([])
        const warnCalls = logSpy.mock.calls.filter((c) => /fp:h/.test(String(c[0] ?? '')))
        expect(warnCalls.length).toBe(1)
        logSpy.mockRestore()
    })

    it('rejects --features for an id not advertised by the template', async () => {
        const tpl = makeTemplate({
            id: 'tpl-bad-force',
            optionalFeatures: ['fp:i'],
            defaultEnabledOptional: [],
        })
        registerOnce(makeFeature('fp:i'))
        await expect(
            resolveOptionalFeatures(
                tpl,
                defaultArgs({ yes: true, features: ['fp:not-listed'] }),
                registries,
            ),
        ).rejects.toThrow(/not optional/)
    })

    it('interactive: multiselect with defaults pre-checked', async () => {
        for (const id of ['fp:j', 'fp:k']) registerOnce(makeFeature(id, `Label-${id}`))
        const tpl = makeTemplate({
            id: 'tpl-interactive',
            optionalFeatures: ['fp:j', 'fp:k'],
            defaultEnabledOptional: ['fp:j'],
        })
        prompts.inject([['fp:j']])
        const out = await resolveOptionalFeatures(tpl, defaultArgs(), registries)
        expect([...out]).toEqual(['fp:j'])
    })

    it('interactive: --features are excluded from multiselect but still enabled', async () => {
        for (const id of ['fp:l', 'fp:m', 'fp:n']) registerOnce(makeFeature(id))
        const tpl = makeTemplate({
            id: 'tpl-force-interactive',
            optionalFeatures: ['fp:l', 'fp:m', 'fp:n'],
            defaultEnabledOptional: ['fp:m'],
        })
        prompts.inject([['fp:m']])
        const out = await resolveOptionalFeatures(
            tpl,
            defaultArgs({ features: ['fp:l'] }),
            registries,
        )
        expect([...out].sort()).toEqual(['fp:l', 'fp:m'])
    })
})

// `makeTemplate()` above hand-builds a `Template`, so its bare ids match themselves
// whether or not canonicalization ran. This one drives the REAL loader pipeline.
describe('resolveOptionalFeatures: real applyPlugin/finalizeRegistries path', () => {
    it('a bare-authored defaultEnabledOptional id still ends up selected after canonicalization', async () => {
        const regs = new BattlestackRegistries()
        applyPlugin(defineBattlestackPlugin({
            name: '@test/e2e-selection',
            apiVersion: 1,
            namespace: 'e2e',
            register(battlestack) {
                battlestack.addFeature({
                    id: 'shared:e2e-opt',
                    label: 'E2E optional',
                    version: '0.1.0',
                    stage: STAGE.STYLING,
                    async execute() {},
                })
                battlestack.addTemplate({
                    id: 'e2e-template',
                    label: 'E2E template',
                    framework: 'e2e-fw',
                    requiredFeatures: [],
                    // Authored bare, exactly as the preset authors its own lists.
                    optionalFeatures: ['shared:e2e-opt'],
                    defaultEnabledOptional: ['shared:e2e-opt'],
                })
            },
        }), 'bundled', regs)
        finalizeRegistries(regs, [])

        const tpl = regs.templates.get('e2e-template')
        // Confirm this really is the canonicalized fqid shape: if it is not, the test
        // below is not testing what it claims to.
        expect(tpl.optionalFeatures).toEqual(['e2e:shared:e2e-opt'])
        expect(tpl.defaultEnabledOptional).toEqual(['e2e:shared:e2e-opt'])

        const out = await resolveOptionalFeatures(tpl, defaultArgs({ yes: true }), regs)
        expect([...out]).toEqual(['e2e:shared:e2e-opt'])
    })

    // The interactive path is deliberately NOT covered: `prompts.inject()` overrides the
    // resolved answer, so no test built on it can observe the pre-check.
})

describe('runFeaturePromptHooks', () => {
    it('invokes hook for enabled features only, skipping disabled', async () => {
        const calls: string[] = []
        const a: Feature = {
            id: 'fp-hook:a',
            label: 'A',
            version: '0.1.0',
            stage: STAGE.STYLING,
            async execute() {},
            async prompt() {
                calls.push('a')
            },
        }
        const b: Feature = {
            id: 'fp-hook:b',
            label: 'B',
            version: '0.1.0',
            stage: STAGE.STYLING,
            async execute() {},
            async prompt() {
                calls.push('b')
            },
        }
        registerOnce(a)
        registerOnce(b)
        const ctx = {
            state: {},
        } as unknown as RunContext
        await runFeaturePromptHooks(new Set([a.id]), ctx, registries)
        expect(calls).toEqual(['a'])
    })

    it('skips features that do not declare a prompt hook', async () => {
        const noHook = makeFeature('fp-hook:no-hook', 'NoHook')
        registerOnce(noHook)
        const ctx = { state: {} } as unknown as RunContext
        await expect(
            runFeaturePromptHooks(new Set([noHook.id]), ctx, registries),
        ).resolves.toBeUndefined()
    })
})

describe('confirmProceed', () => {
    it('returns true unconditionally under --yes', async () => {
        expect(await confirmProceed(defaultArgs({ yes: true }))).toBe(true)
    })

    it('returns true unconditionally under CI=true', async () => {
        process.env.CI = 'true'
        expect(await confirmProceed(defaultArgs())).toBe(true)
    })

    it('returns user choice in interactive mode (yes)', async () => {
        prompts.inject([true])
        expect(await confirmProceed(defaultArgs())).toBe(true)
    })

    it('returns false when user cancels at confirmation prompt', async () => {
        prompts.inject([false])
        expect(await confirmProceed(defaultArgs())).toBe(false)
    })
})

describe('confirmOverwriteOwned', () => {
    const atRisk = [{ featureId: 'fp:owned-feat', files: ['a.ts', 'b.ts'] }]

    it('returns true unconditionally under --yes, without consuming an injected prompt response', async () => {
        // No `prompts.inject()` on purpose: if this reached the real prompt the queue is
        // empty and `prompts` throws, so a regression fails loudly instead of hanging.
        expect(await confirmOverwriteOwned(defaultArgs({ yes: true }), atRisk)).toBe(true)
    })

    it('returns true unconditionally under CI=true', async () => {
        process.env.CI = 'true'
        expect(await confirmOverwriteOwned(defaultArgs(), atRisk)).toBe(true)
    })

    it('returns true immediately when nothing is at risk: never prompts for an empty list', async () => {
        expect(await confirmOverwriteOwned(defaultArgs(), [])).toBe(true)
    })

    it('returns user choice in interactive mode (yes)', async () => {
        prompts.inject([true])
        expect(await confirmOverwriteOwned(defaultArgs(), atRisk)).toBe(true)
    })

    it('returns false when user declines: the default is "no", unlike confirmProceed', async () => {
        prompts.inject([false])
        expect(await confirmOverwriteOwned(defaultArgs(), atRisk)).toBe(false)
    })
})
