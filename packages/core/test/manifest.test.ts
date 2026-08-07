import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashFile, readManifest, reconcileProjectName, recordFile, writeManifest } from '../src/manifest.js'
import { BattlestackRegistries } from '../src/registry.js'
import type { Feature } from '../src/types/feature.js'
import type { ProjectManifest } from '../src/types/project-manifest.js'
import type { RunContext } from '../src/types/run-context.js'
import { STAGE } from '../src/constants/stages.js'

// Namespace kept distinct from the features' own `test:<name>` shape, so a persisted
// fqid reads unambiguously rather than colliding visually with the authored id.
const origin = { plugin: 'test-plugin', namespace: 'demo' }

const fakeFeature = (id: string, version = '0.1.0'): Feature => ({
    id,
    version,
    label: id,
    stage: STAGE.STYLING,
    async execute() {},
})

let tmpDir: string
let registries: BattlestackRegistries

beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-manifest-test-'))
    registries = new BattlestackRegistries()
    registries.frameworks.register({ id: 'manifest-test', label: 'manifest-test', supportedFeatures: [] }, origin)
    registries.templates.register({
        id: 'manifest-test', label: 'manifest-test', framework: 'manifest-test', requiredFeatures: [], optionalFeatures: [],
    }, origin)
})

afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
})

/**
 * Stands in for "the CLI was upgraded between runs": `Registry.register` throws on a
 * duplicate fqid, so a version bump needs a second, independent registries instance.
 */
function makeRegistries(): BattlestackRegistries {
    const r = new BattlestackRegistries()
    r.frameworks.register({ id: 'manifest-test', label: 'manifest-test', supportedFeatures: [] }, origin)
    r.templates.register({
        id: 'manifest-test', label: 'manifest-test', framework: 'manifest-test', requiredFeatures: [], optionalFeatures: [],
    }, origin)
    return r
}

function makeCtx(enabled: string[], regs: BattlestackRegistries = registries): RunContext {
    return {
        projectName: 'demo',
        projectDir: tmpDir,
        framework: regs.frameworks.get('manifest-test'),
        template: regs.templates.get('manifest-test'),
        enabledFeatures: new Set(enabled),
        state: { packageManager: 'pnpm' },
        debug: false,
        dryRun: false,
        registries: regs,
    }
}

const manifestPath = () => path.join(tmpDir, '.battlestack', 'manifest.json')

describe('manifest', () => {
    it('readManifest returns null when missing', async () => {
        expect(await readManifest(tmpDir)).toBeNull()
    })

    it('writeManifest + readManifest round-trip', async () => {
        registries.features.register(fakeFeature('test:manifest-a'), origin)
        const ctx = makeCtx(['test:manifest-a'])

        recordFile(ctx, 'test:manifest-a', 'foo.txt', 'abc123')
        await writeManifest(ctx)

        const m = await readManifest(tmpDir)
        expect(m).not.toBeNull()
        const manifest = m as ProjectManifest
        expect(manifest.framework).toBe('manifest-test')
        expect(manifest.features).toHaveLength(1)
        // Persisted record id is the fqid, not the bare authored id.
        expect(manifest.features[0]?.id).toBe('demo:test:manifest-a')
        expect(manifest.features[0]?.files['foo.txt']).toBe('abc123')
    })

    describe('writeManifest: no-op vs. real-change contract', () => {
        // Case 1: createdAt survives every write. A no-op skips writing entirely; a real
        // write explicitly carries `previous.createdAt` forward.
        it('preserves createdAt across a real re-write', async () => {
            registries.features.register(fakeFeature('test:manifest-b'), origin)
            const ctx = makeCtx(['test:manifest-b'])

            await writeManifest(ctx)
            const first = (await readManifest(tmpDir)) as ProjectManifest

            registries.features.register(fakeFeature('test:manifest-b2'), origin)
            ctx.enabledFeatures.add('test:manifest-b2')
            await new Promise((r) => setTimeout(r, 10))
            await writeManifest(ctx)
            const second = (await readManifest(tmpDir)) as ProjectManifest

            expect(second.createdAt).toBe(first.createdAt)
        })

        // Case 2: nothing changed, so updatedAt must not move and, the stronger claim,
        // the write must not happen at all.
        it('does not move updatedAt (or touch the file) on a genuine no-op', async () => {
            registries.features.register(fakeFeature('test:noop-a'), origin)
            const ctx = makeCtx(['test:noop-a'])

            await writeManifest(ctx)
            const firstRaw = await readFile(manifestPath(), 'utf8')
            const firstStat = await stat(manifestPath())
            const first = JSON.parse(firstRaw) as ProjectManifest

            // Real time must pass, or a same-millisecond `updatedAt` coincidentally
            // matches and masks a no-op check that is not actually skipping the write.
            await new Promise((r) => setTimeout(r, 10))
            await writeManifest(ctx)

            const secondRaw = await readFile(manifestPath(), 'utf8')
            const secondStat = await stat(manifestPath())
            const second = JSON.parse(secondRaw) as ProjectManifest

            // Byte- and mtime-identical is the load-bearing assertion: a comparator that
            // recomputed the same `updatedAt` would pass that check yet rewrite the file.
            expect(secondRaw).toBe(firstRaw)
            expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs)
            expect(second.updatedAt).toBe(first.updatedAt)
        })

        it('no-op detection is order-insensitive on the enabled-feature Set', async () => {
            registries.features.register(fakeFeature('test:noop-order-a'), origin)
            registries.features.register(fakeFeature('test:noop-order-b'), origin)
            const ctx = makeCtx(['test:noop-order-a', 'test:noop-order-b'])
            await writeManifest(ctx)
            const firstRaw = await readFile(manifestPath(), 'utf8')

            // Same two features, reversed insertion order: a different Set with the same
            // content, which is what a second CLI invocation naturally produces.
            const ctx2 = makeCtx(['test:noop-order-b', 'test:noop-order-a'])
            await new Promise((r) => setTimeout(r, 10))
            await writeManifest(ctx2)

            const secondRaw = await readFile(manifestPath(), 'utf8')
            expect(secondRaw).toBe(firstRaw)
        })

        it('writes sorted-by-id feature records, independent of Set insertion order', async () => {
            registries.features.register(fakeFeature('test:zeta'), origin)
            registries.features.register(fakeFeature('test:alpha'), origin)
            const ctx = makeCtx(['test:zeta', 'test:alpha'])
            await writeManifest(ctx)

            const m = (await readManifest(tmpDir)) as ProjectManifest
            expect(m.features.map((f) => f.id)).toEqual(['demo:test:alpha', 'demo:test:zeta'])
        })

        // Case 3 matters most: a detector hardwired to "never changed" passes case 2 by
        // construction, and only these catch it. Verified by hardwiring it to `true`.
        it('DOES move updatedAt when a feature is added', async () => {
            registries.features.register(fakeFeature('test:real-a'), origin)
            registries.features.register(fakeFeature('test:real-b'), origin)
            const ctx = makeCtx(['test:real-a'])

            await writeManifest(ctx)
            const first = (await readManifest(tmpDir)) as ProjectManifest

            await new Promise((r) => setTimeout(r, 10))
            ctx.enabledFeatures.add('test:real-b')
            await writeManifest(ctx)
            const second = (await readManifest(tmpDir)) as ProjectManifest

            expect(second.updatedAt).not.toBe(first.updatedAt)
            expect(second.features.map((f) => f.id)).toEqual(
                ['demo:test:real-a', 'demo:test:real-b'].sort(),
            )
        })

        it('DOES move updatedAt when a feature version changes', async () => {
            const regsOld = makeRegistries()
            regsOld.features.register(fakeFeature('test:real-ver', '1.0.0'), origin)
            await writeManifest(makeCtx(['test:real-ver'], regsOld))
            const first = (await readManifest(tmpDir)) as ProjectManifest
            expect(first.features[0]?.version).toBe('1.0.0')

            const regsNew = makeRegistries()
            regsNew.features.register(fakeFeature('test:real-ver', '2.0.0'), origin)
            await new Promise((r) => setTimeout(r, 10))
            await writeManifest(makeCtx(['test:real-ver'], regsNew))
            const second = (await readManifest(tmpDir)) as ProjectManifest

            expect(second.updatedAt).not.toBe(first.updatedAt)
            expect(second.features[0]?.version).toBe('2.0.0')
        })

        it('DOES move updatedAt when cliVersion changes (a real CLI upgrade), even with identical features', async () => {
            registries.features.register(fakeFeature('test:real-cli'), origin)
            const ctx = makeCtx(['test:real-cli'])

            await writeManifest(ctx, { cliVersion: '1.0.0' })
            const first = (await readManifest(tmpDir)) as ProjectManifest

            await new Promise((r) => setTimeout(r, 10))
            await writeManifest(ctx, { cliVersion: '1.1.0' })
            const second = (await readManifest(tmpDir)) as ProjectManifest

            expect(second.updatedAt).not.toBe(first.updatedAt)
            expect(second.cliVersion).toBe('1.1.0')
        })
    })

    // These three set the SAME trap: a malformed manifest whose repaired IN-MEMORY form
    // equals the candidate write, so a no-op skip leaves the on-disk bytes broken.
    describe('normalize/migrate must force a write even when the repaired shape looks unchanged', () => {
        it('migration: a legacy manifest is rewritten to the current shape', async () => {
            // Registries where the migrated legacy id resolves to exactly the fqid
            // writeManifest would itself produce for the SAME enabled feature.
            const regs = new BattlestackRegistries()
            regs.frameworks.register({ id: 'nuxt4', label: 'nuxt4', supportedFeatures: [] }, origin)
            regs.templates.register(
                { id: 'legacy-template', label: 'legacy-template', framework: 'nuxt4', requiredFeatures: [], optionalFeatures: [] },
                origin,
            )
            regs.features.register(fakeFeature('nuxt4:database', '1.0.0'), origin)

            const target = manifestPath()
            await mkdir(path.dirname(target), { recursive: true })
            const legacy: ProjectManifest = {
                schemaVersion: 1,
                cliVersion: '9.9.9',
                framework: 'nuxt', // unversioned legacy framework
                template: 'legacy-template',
                packageManager: 'pnpm',
                projectName: path.basename(tmpDir),
                createdAt: '2025-01-01T00:00:00.000Z',
                updatedAt: '2025-01-01T00:00:00.000Z',
                features: [{ id: 'nuxt:database', version: '1.0.0', files: {} }], // legacy bare id
            }
            await writeFile(target, JSON.stringify(legacy, null, 4) + '\n', 'utf8')
            const beforeRaw = await readFile(target, 'utf8')

            const ctx: RunContext = {
                projectName: 'demo',
                projectDir: tmpDir,
                framework: regs.frameworks.get('nuxt4'),
                template: regs.templates.get('legacy-template'),
                enabledFeatures: new Set(['nuxt4:database']),
                state: { packageManager: 'pnpm' },
                debug: false,
                dryRun: false,
                registries: regs,
            }
            await writeManifest(ctx, { cliVersion: '9.9.9' })

            const afterRaw = await readFile(target, 'utf8')
            const after = JSON.parse(afterRaw) as ProjectManifest
            // The migrated-in-memory shape already matches what this write would produce,
            // so without `needsRewrite` the legacy bytes below would never be repaired.
            expect(afterRaw).not.toBe(beforeRaw)
            expect(after.framework).toBe('nuxt4')
            expect(after.features.map((f) => f.id)).toEqual(['demo:nuxt4:database'])
        })

        it('normalization: a malformed (empty-string) packageManager is repaired', async () => {
            registries.features.register(fakeFeature('test:norm-pm'), origin)
            const ctx = makeCtx(['test:norm-pm'])

            const target = manifestPath()
            await mkdir(path.dirname(target), { recursive: true })
            const onDisk: ProjectManifest = {
                schemaVersion: 1,
                cliVersion: '9.9.9',
                framework: 'manifest-test',
                template: 'manifest-test',
                packageManager: '', // malformed; normalizeManifest defaults this to 'pnpm'
                projectName: path.basename(tmpDir),
                createdAt: '2025-01-01T00:00:00.000Z',
                updatedAt: '2025-01-01T00:00:00.000Z',
                features: [{ id: 'demo:test:norm-pm', version: '0.1.0', files: {} }],
            }
            await writeFile(target, JSON.stringify(onDisk, null, 4) + '\n', 'utf8')
            const beforeRaw = await readFile(target, 'utf8')

            await writeManifest(ctx, { cliVersion: '9.9.9' })

            const afterRaw = await readFile(target, 'utf8')
            const after = JSON.parse(afterRaw) as ProjectManifest
            expect(afterRaw).not.toBe(beforeRaw)
            expect(after.packageManager).toBe('pnpm')
        })

        it('normalization: a missing features array is repaired', async () => {
            const ctx = makeCtx([])

            const target = manifestPath()
            await mkdir(path.dirname(target), { recursive: true })
            const onDisk = {
                schemaVersion: 1,
                cliVersion: '9.9.9',
                framework: 'manifest-test',
                template: 'manifest-test',
                packageManager: 'pnpm',
                projectName: path.basename(tmpDir),
                createdAt: '2025-01-01T00:00:00.000Z',
                updatedAt: '2025-01-01T00:00:00.000Z',
                // `features` intentionally omitted: a hand-edited/pre-feature manifest.
            }
            await writeFile(target, JSON.stringify(onDisk, null, 4) + '\n', 'utf8')
            const beforeRaw = await readFile(target, 'utf8')

            await writeManifest(ctx, { cliVersion: '9.9.9' })

            const afterRaw = await readFile(target, 'utf8')
            const after = JSON.parse(afterRaw) as ProjectManifest
            expect(afterRaw).not.toBe(beforeRaw)
            expect(after.features).toEqual([])
        })
    })

    it('readManifest defaults packageManager and features on legacy/hand-edited manifests', async () => {
        const target = path.join(tmpDir, '.battlestack', 'manifest.json')
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(
            target,
            JSON.stringify({
                schemaVersion: 1,
                cliVersion: '0.0.0',
                framework: 'nuxt',
                template: 'nuxt4-minimal',
                createdAt: '2026-01-01',
                updatedAt: '2026-01-01',
            }),
            'utf8',
        )

        const m = (await readManifest(tmpDir)) as ProjectManifest
        expect(m.packageManager).toBe('pnpm')
        expect(m.features).toEqual([])
    })

    it('readManifest keeps an explicit packageManager', async () => {
        await mkdir(path.join(tmpDir, '.battlestack'), { recursive: true })
        await writeFile(
            path.join(tmpDir, '.battlestack', 'manifest.json'),
            JSON.stringify({
                schemaVersion: 1,
                cliVersion: '0.0.0',
                framework: 'nuxt',
                template: 'nuxt4-minimal',
                packageManager: 'bun',
                createdAt: '2026-01-01',
                updatedAt: '2026-01-01',
                features: [],
            }),
            'utf8',
        )

        const m = (await readManifest(tmpDir)) as ProjectManifest
        expect(m.packageManager).toBe('bun')
    })

    it('hashFile returns deterministic sha256', async () => {
        const target = path.join(tmpDir, 'file.txt')
        await writeFile(target, 'hello world', 'utf8')
        const h1 = await hashFile(target)
        const h2 = await hashFile(target)
        expect(h1).toBe(h2)
        expect(h1).toMatch(/^[a-f0-9]{64}$/)
    })

    it('writeManifest stamps projectName from the directory basename', async () => {
        registries.features.register(fakeFeature('test:manifest-d'), origin)
        const ctx = makeCtx(['test:manifest-d'])

        await writeManifest(ctx)
        const m = (await readManifest(tmpDir)) as ProjectManifest
        expect(m.projectName).toBe(path.basename(tmpDir))
    })

    it('writeManifest honors an explicit cliVersion override', async () => {
        registries.features.register(fakeFeature('test:manifest-g'), origin)
        const ctx = makeCtx(['test:manifest-g'])

        await writeManifest(ctx, { cliVersion: '9.9.9' })
        const m = (await readManifest(tmpDir)) as ProjectManifest
        expect(m.cliVersion).toBe('9.9.9')
    })

    it('reconcileProjectName returns the old name on rename and restamps', async () => {
        registries.features.register(fakeFeature('test:manifest-e'), origin)
        const ctx = makeCtx(['test:manifest-e'])
        await writeManifest(ctx)

        const m = (await readManifest(tmpDir)) as ProjectManifest
        m.projectName = 'old-name'

        expect(await reconcileProjectName(tmpDir, m)).toBe('old-name')
        const after = (await readManifest(tmpDir)) as ProjectManifest
        expect(after.projectName).toBe(path.basename(tmpDir))
        // Second run: quiet.
        expect(await reconcileProjectName(tmpDir, after)).toBeNull()
    })

    it('reconcileProjectName stamps legacy manifests silently', async () => {
        registries.features.register(fakeFeature('test:manifest-f'), origin)
        const ctx = makeCtx(['test:manifest-f'])
        await writeManifest(ctx)

        const m = (await readManifest(tmpDir)) as ProjectManifest
        delete m.projectName

        expect(await reconcileProjectName(tmpDir, m)).toBeNull()
        const after = (await readManifest(tmpDir)) as ProjectManifest
        expect(after.projectName).toBe(path.basename(tmpDir))
    })

    it('recordFile accumulates entries in ctx.state', () => {
        registries.features.register(fakeFeature('test:manifest-c'), origin)
        const ctx = makeCtx(['test:manifest-c'])

        recordFile(ctx, 'test:manifest-c', 'a.ts', 'h1')
        recordFile(ctx, 'test:manifest-c', 'b.ts', 'h2')

        const map = ctx.state['files:test:manifest-c'] as Record<string, string>
        expect(map).toEqual({ 'a.ts': 'h1', 'b.ts': 'h2' })
    })
})
