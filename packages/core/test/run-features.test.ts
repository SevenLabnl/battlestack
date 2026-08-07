import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Ora } from 'ora'
import { runFeatures } from '../src/orchestrator.js'
import { BattlestackRegistries } from '../src/registry.js'
import { STAGE } from '../src/constants/stages.js'
import type { Feature } from '../src/types/feature.js'
import type { RunContext } from '../src/types/run-context.js'

const origin = { plugin: 'test-plugin', namespace: 'test' }

let projectDir: string
const calls: string[] = []

const okFeature: Feature = {
    id: 'rf:ok',
    version: '1.0.0',
    label: 'ok feature',
    stage: STAGE.SCAFFOLD,
    execute: async () => {
        calls.push('rf:ok')
    },
}
const nonFatalFeature: Feature = {
    id: 'rf:nonfatal',
    version: '1.0.0',
    label: 'non-fatal feature',
    stage: STAGE.DATABASE,
    failureIsNonFatal: true,
    execute: async () => {
        throw new Error('boom-nonfatal')
    },
}
const fatalFeature: Feature = {
    id: 'rf:fatal',
    version: '1.0.0',
    label: 'fatal feature',
    stage: STAGE.DATABASE,
    execute: async () => {
        throw new Error('boom-fatal')
    },
}
const structuralFeature: Feature = {
    id: 'rf:structural',
    version: '1.0.0',
    label: 'structural feature',
    stage: STAGE.GITIGNORE,
    execute: async (ctx) => {
        ;(ctx.state as Record<string, unknown>)['files:rf:structural'] = { 'a.txt': 'hash' }
    },
    structuralFiles: (ctx) =>
        Object.keys((ctx.state[`files:rf:structural`] as Record<string, string>) ?? {}),
}

const registries = new BattlestackRegistries()
registries.frameworks.register({ id: 'nuxt', label: 'nuxt', supportedFeatures: [] }, origin)
registries.templates.register({
    id: 'tpl', label: 'tpl', framework: 'nuxt', requiredFeatures: [], optionalFeatures: [],
}, origin)
registries.features.register(okFeature, origin)
registries.features.register(nonFatalFeature, origin)
registries.features.register(fatalFeature, origin)
registries.features.register(structuralFeature, origin)

function fakeLoader(): Ora {
    return {
        start() { return this },
        succeed() { return this },
        fail() { return this },
        warn() { return this },
        info() { return this },
        stop() { return this },
        text: '',
        isSpinning: false,
        clear() { return this },
        render() { return this },
        frame() { return '' },
    } as unknown as Ora
}

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-runfeat-test-'))
    calls.length = 0
})

afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
})

function ctx(features: string[], extra: Record<string, unknown> = {}): RunContext {
    return {
        projectName: 'demo',
        projectDir,
        framework: registries.frameworks.get('nuxt'),
        template: registries.templates.get('tpl'),
        enabledFeatures: new Set(features),
        state: { packageManager: 'pnpm', skipInstall: true },
        debug: false,
        dryRun: false,
        registries,
        ...extra,
    } as unknown as RunContext
}

async function manifest(): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(path.join(projectDir, '.battlestack', 'manifest.json'), 'utf8'))
}

describe('runFeatures', () => {
    it('executes enabled features and writes a manifest', async () => {
        await runFeatures(ctx(['rf:ok']), fakeLoader())
        expect(calls).toEqual(['rf:ok'])
        const m = await manifest()
        // Persisted record id is the fqid, not the bare authored id.
        expect((m.features as Array<{ id: string }>).map((f) => f.id)).toContain('test:rf:ok')
        expect(m.incomplete).toBeFalsy()
    })

    it('continues past non-fatal failures', async () => {
        await runFeatures(ctx(['rf:nonfatal', 'rf:ok']), fakeLoader())
        expect(calls).toEqual(['rf:ok'])
        expect(await manifest()).toBeDefined()
    })

    it('throws on fatal failure and marks the manifest incomplete', async () => {
        await expect(runFeatures(ctx(['rf:fatal']), fakeLoader())).rejects.toThrow(
            /rf:fatal failed: boom-fatal/,
        )
        expect((await manifest()).incomplete).toBe(true)
    })

    it('records structuralFiles as owned in the manifest', async () => {
        await runFeatures(ctx(['rf:structural']), fakeLoader())
        const m = await manifest()
        const rec = (m.features as Array<{ id: string, ownedByUser?: string[] }>).find(
            (f) => f.id === 'test:rf:structural',
        )
        expect(rec?.ownedByUser).toContain('a.txt')
    })

    it('dry-run executes nothing and writes no manifest', async () => {
        await runFeatures(ctx(['rf:ok'], { dryRun: true }), fakeLoader())
        expect(calls).toEqual([])
        await expect(readFile(path.join(projectDir, '.battlestack', 'manifest.json'))).rejects.toThrow()
    })

    it('validates the RunContext shape', async () => {
        const bad = ctx(['rf:ok'])
        ;(bad as { framework: unknown }).framework = {}
        await expect(runFeatures(bad, fakeLoader())).rejects.toThrow(/framework\.id/)
    })
})
