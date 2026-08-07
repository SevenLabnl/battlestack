import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    addArgs,
    BattlestackRegistries,
    type Feature,
    type Provenance,
} from '@battlestack/core'
import { defaultArgs, withCwd, withCwdCapture } from './test-utils.js'

/**
 * `bumpCommand` is the only export, so dependency collection is covered through it:
 * register features with varied `collectDeps` shapes and assert on the `run()` calls.
 */

const run = vi.fn(async (_cmd: string, _args: string[], _opts?: unknown) => ({ stdout: '', stderr: '', code: 0 }))
vi.mock('@battlestack/core', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    run: (...a: Parameters<typeof run>) => run(...a),
}))

const { bumpCommand } = await import('../src/commands/bump.js')

const origin: Provenance = { plugin: '@test/bump', namespace: 'bumptest' }
let projectDir: string
let registries: BattlestackRegistries

function registerFeature(feature: Feature): void {
    if (!registries.features.has(feature.id)) registries.features.register(feature, origin)
}

async function writeManifestFile(featureIds: string[]): Promise<void> {
    await mkdir(path.join(projectDir, '.battlestack'), { recursive: true })
    await writeFile(
        path.join(projectDir, '.battlestack', 'manifest.json'),
        JSON.stringify({
            schemaVersion: 1,
            cliVersion: '0.0.0',
            framework: 'bump-test-fw',
            template: 'bump-test-tpl',
            packageManager: 'pnpm',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            // Bare ids, resolved against `registries.features` the same way `enabledHas`'s
            // fast path would; bump.ts iterates `manifest.features` directly.
            features: featureIds.map((id) => ({ id, version: '1.0.0', files: {} })),
        }),
        'utf8',
    )
}

beforeEach(async () => {
    // `bumpCommand` resolves its root from `process.cwd()`, and on macOS a tmpdir path
    // reports back its `/private/var/...` realpath. Resolve up front so assertions match.
    projectDir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'battlestack-bump-test-')))
    registries = new BattlestackRegistries()
    registries.frameworks.register({ id: 'bump-test-fw', label: 'fw', supportedFeatures: [] }, origin)
    registries.templates.register(
        { id: 'bump-test-tpl', label: 'tpl', framework: 'bump-test-fw', requiredFeatures: [], optionalFeatures: [] },
        origin,
    )
    run.mockClear()
})

afterEach(async () => {
    vi.restoreAllMocks()
    await rm(projectDir, { recursive: true, force: true })
})

async function runBump(args: Parameters<typeof defaultArgs>[0] = {}): Promise<string[]> {
    return withCwdCapture(projectDir, () => bumpCommand(defaultArgs(args), undefined as never, registries))
}

describe('bumpCommand', () => {
    it('throws outside a project', async () => {
        const outside = await mkdtemp(path.join(os.tmpdir(), 'battlestack-bump-outside-'))
        try {
            await expect(
                withCwd(outside, () => bumpCommand(defaultArgs(), undefined as never, registries)),
            ).rejects.toThrow(/Not inside a battlestack project/)
        } finally {
            await rm(outside, { recursive: true, force: true })
        }
    })

    it('reports nothing to upgrade when no enabled feature contributes deps', async () => {
        registerFeature({
            id: 'feat:nodeps',
            label: 'x',
            version: '1.0.0',
            stage: 'FINALIZE',
            async execute() {},
        })
        await writeManifestFile(['feat:nodeps'])
        const lines = await runBump()
        expect(lines.join('\n')).toContain('No deps tracked by features, nothing to upgrade')
        expect(run).not.toHaveBeenCalled()
    })

    it('skips a feature with no collectDeps at all without throwing', async () => {
        registerFeature({
            id: 'feat:silent',
            label: 'x',
            version: '1.0.0',
            stage: 'FINALIZE',
            async execute() {},
        })
        await writeManifestFile(['feat:silent'])
        await expect(runBump()).resolves.toBeDefined()
    })

    it('skips a manifest record for a feature no longer registered (orphaned) without throwing', async () => {
        await writeManifestFile(['feat:long-gone'])
        await expect(runBump()).resolves.toBeDefined()
        expect(run).not.toHaveBeenCalled()
    })

    it('appends @latest to a bare dep but leaves an already-versioned spec untouched', async () => {
        registerFeature({
            id: 'feat:mixed',
            label: 'x',
            version: '1.0.0',
            stage: 'FINALIZE',
            async execute() {},
            collectDeps: () => ({ prod: ['bare-pkg', 'pinned-pkg@^2.0.0'] }),
        })
        await writeManifestFile(['feat:mixed'])
        await runBump()
        const [, prodArgs] = run.mock.calls[0]! as [string, string[]]
        expect(prodArgs).toContain('bare-pkg@latest')
        expect(prodArgs).toContain('pinned-pkg@^2.0.0')
    })

    it('appends @latest to a bare SCOPED package correctly, without mistaking the scope\'s "@" for a version pin', async () => {
        // `toUpgradeSpec` finds the pin via `lastIndexOf('@')`; a naive `indexOf` misreads
        // a scoped name's leading `@` as a pin. `collectDeps` really returns such names.
        registerFeature({
            id: 'feat:scoped',
            label: 'x',
            version: '1.0.0',
            stage: 'FINALIZE',
            async execute() {},
            collectDeps: () => ({ prod: ['@scope/bare-pkg', '@scope/pinned-pkg@1.2.3'] }),
        })
        await writeManifestFile(['feat:scoped'])
        await runBump()
        const [, prodArgs] = run.mock.calls[0]! as [string, string[]]
        expect(prodArgs).toContain('@scope/bare-pkg@latest')
        expect(prodArgs).toContain('@scope/pinned-pkg@1.2.3')
    })

    it('dedupes a dep declared by more than one feature', async () => {
        registerFeature({
            id: 'feat:a',
            label: 'x',
            version: '1.0.0',
            stage: 'FINALIZE',
            async execute() {},
            collectDeps: () => ({ prod: ['shared-pkg'] }),
        })
        registerFeature({
            id: 'feat:b',
            label: 'x',
            version: '1.0.0',
            stage: 'FINALIZE',
            async execute() {},
            collectDeps: () => ({ prod: ['shared-pkg'] }),
        })
        await writeManifestFile(['feat:a', 'feat:b'])
        await runBump()
        const [, prodArgs] = run.mock.calls[0]! as [string, string[]]
        expect(prodArgs.filter((a) => a === 'shared-pkg@latest')).toHaveLength(1)
    })

    it('aggregates prod and dev deps across features into two separate `run` calls', async () => {
        registerFeature({
            id: 'feat:prod-only',
            label: 'x',
            version: '1.0.0',
            stage: 'FINALIZE',
            async execute() {},
            collectDeps: () => ({ prod: ['prod-pkg'] }),
        })
        registerFeature({
            id: 'feat:dev-only',
            label: 'x',
            version: '1.0.0',
            stage: 'FINALIZE',
            async execute() {},
            collectDeps: () => ({ dev: ['dev-pkg'] }),
        })
        await writeManifestFile(['feat:prod-only', 'feat:dev-only'])
        await runBump()

        expect(run).toHaveBeenCalledTimes(2)
        expect(run).toHaveBeenNthCalledWith(
            1, 'pnpm', addArgs('pnpm', ['prod-pkg@latest'], false), { cwd: projectDir, inherit: true },
        )
        expect(run).toHaveBeenNthCalledWith(
            2, 'pnpm', addArgs('pnpm', ['dev-pkg@latest'], true), { cwd: projectDir, inherit: true },
        )
    })

    it('only calls run for the prod half when nothing declares a dev dep', async () => {
        registerFeature({
            id: 'feat:prod-only-2',
            label: 'x',
            version: '1.0.0',
            stage: 'FINALIZE',
            async execute() {},
            collectDeps: () => ({ prod: ['solo-pkg'] }),
        })
        await writeManifestFile(['feat:prod-only-2'])
        await runBump()
        expect(run).toHaveBeenCalledTimes(1)
        expect(run).toHaveBeenCalledWith('pnpm', addArgs('pnpm', ['solo-pkg@latest'], false), expect.anything())
    })

    it('dry-run prints the planned commands and never calls run', async () => {
        registerFeature({
            id: 'feat:dry',
            label: 'x',
            version: '1.0.0',
            stage: 'FINALIZE',
            async execute() {},
            collectDeps: () => ({ prod: ['dry-pkg'], dev: ['dry-dev-pkg'] }),
        })
        await writeManifestFile(['feat:dry'])
        const lines = await runBump({ dryRun: true })
        expect(run).not.toHaveBeenCalled()
        const text = lines.join('\n')
        expect(text).toContain('would: pnpm')
        expect(text).toContain('dry-pkg@latest')
        expect(text).toContain('dry-dev-pkg@latest')
    })
})
