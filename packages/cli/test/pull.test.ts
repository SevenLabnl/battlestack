import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import prompts from 'prompts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pullCommand } from '../src/commands/pull.js'
import { ownCommand } from '../src/commands/own.js'
import {
    BattlestackRegistries,
    copyTemplateDirRecorded,
    exists,
    hashFile,
    MANIFEST_PATH,
    silentLoader,
    STAGE,
    updateFromTemplateDir,
    writeManifest,
    type Feature,
    type ParsedArgs,
    type ProjectManifest,
    type Provenance,
    type RunContext,
} from '@battlestack/core'
import { defaultArgs, withCwd } from './test-utils.js'

/**
 * `pullCommand` is the ONE command that rewrites files a user may have hand-edited, and
 * a bad overwrite is unrecoverable without a clean git tree.
 */

const NAMESPACE = 'pulltest'
const FW = 'pull-test-fw'
const TPL = 'pull-test-tpl'
const origin: Provenance = { plugin: '@test/pull', namespace: NAMESPACE }

/**
 * These fixtures build template feature lists by hand, so this mirrors what
 * `finalizeRegistries` OUTPUTS: fqids, the shape `rehydrateMissingFeatures` expects.
 */
const fqid = (bareId: string): string => `${NAMESPACE}:${bareId}`

/** A minimal feature whose execute/update both copy a template directory. */
function makeFileFeature(
    bareId: string,
    version: string,
    templateDir: string,
    opts: { structuralFiles?: string[] } = {},
): Feature {
    return {
        id: bareId,
        label: bareId,
        version,
        stage: STAGE.STYLING,
        ...(opts.structuralFiles ? { structuralFiles: () => opts.structuralFiles! } : {}),
        async execute(ctx) {
            await copyTemplateDirRecorded(ctx, bareId, templateDir)
        },
        async update(ctx, prev) {
            return updateFromTemplateDir(ctx, bareId, templateDir, prev)
        },
    }
}

async function writeTemplateFile(dir: string, rel: string, content: string): Promise<void> {
    const dest = path.join(dir, rel)
    await mkdir(path.dirname(dest), { recursive: true })
    await writeFile(dest, content, 'utf8')
}

function makeRegistries(template: {
    requiredFeatures?: string[]
    optionalFeatures?: string[]
    defaultEnabledOptional?: string[]
} = {}): BattlestackRegistries {
    const registries = new BattlestackRegistries()
    registries.frameworks.register({ id: FW, label: FW, supportedFeatures: [] }, origin)
    registries.templates.register(
        {
            id: TPL,
            label: TPL,
            framework: FW,
            requiredFeatures: template.requiredFeatures ?? [],
            optionalFeatures: template.optionalFeatures ?? [],
            ...(template.defaultEnabledOptional ? { defaultEnabledOptional: template.defaultEnabledOptional } : {}),
        },
        origin,
    )
    return registries
}

function scaffoldCtx(projectDir: string, registries: BattlestackRegistries, enabledFqids: string[]): RunContext {
    return {
        projectName: path.basename(projectDir),
        projectDir,
        framework: registries.frameworks.get(FW),
        template: registries.templates.get(TPL),
        enabledFeatures: new Set(enabledFqids),
        state: { packageManager: 'pnpm' },
        debug: false,
        dryRun: false,
        registries,
    }
}

function args(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
    // `format: false`: the real formatter pass is slow and irrelevant to drift and
    // ownership. Each test opts in to only the flags it exercises.
    return defaultArgs({ format: false, ...overrides })
}

async function readManifestRaw(projectDir: string): Promise<ProjectManifest> {
    return JSON.parse(await readFile(path.join(projectDir, MANIFEST_PATH), 'utf8')) as ProjectManifest
}

const dirs: string[] = []
async function tmp(prefix: string): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
    dirs.push(dir)
    return dir
}

afterEach(async () => {
    while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true })
})

async function runPull(projectDir: string, registries: BattlestackRegistries, overrides: Partial<ParsedArgs> = {}): Promise<void> {
    await withCwd(projectDir, () => pullCommand(args(overrides), silentLoader(), registries))
}

describe('battlestack pull: drift protection (hash mismatch)', () => {
    it('is a true no-op on a same-version pull: update() never runs, and the manifest no-op contract holds across it', async () => {
        const projectDir = await tmp('battlestack-pull-noop-')
        const tplDir = await tmp('battlestack-pull-noop-tpl-')
        await writeTemplateFile(tplDir, 'a.ts', 'v1\n')

        const registries = makeRegistries({ requiredFeatures: [fqid('test:feat-a')] })
        const feature: Feature = {
            id: 'test:feat-a',
            label: 'feat-a',
            version: '1.0.0',
            stage: STAGE.STYLING,
            async execute(ctx) {
                await copyTemplateDirRecorded(ctx, 'test:feat-a', tplDir)
            },
            async update() {
                throw new Error('update() must not run when the recorded version already matches')
            },
        }
        registries.features.register(feature, origin)

        const ctx = scaffoldCtx(projectDir, registries, [fqid('test:feat-a')])
        await feature.execute(ctx)
        await writeManifest(ctx)

        const manifestPath = path.join(projectDir, MANIFEST_PATH)
        const bytesBefore = await readFile(manifestPath, 'utf8')
        const mtimeBefore = (await stat(manifestPath)).mtimeMs

        // Same registries, same version → `pullOneFeature`'s version gate skips
        // before `feature.update` is ever reached.
        await runPull(projectDir, registries)

        const onDisk = await readFile(path.join(projectDir, 'a.ts'), 'utf8')
        expect(onDisk).toBe('v1\n')

        // The no-op-write contract must hold across a whole pull, not just a bare
        // `writeManifest`: a pull that changes nothing must not dirty a committed file.
        const bytesAfter = await readFile(manifestPath, 'utf8')
        const mtimeAfter = (await stat(manifestPath)).mtimeMs
        expect(bytesAfter).toBe(bytesBefore)
        expect(mtimeAfter).toBe(mtimeBefore)
    })

    it('overwrites a pristine (untouched) file when the shipped template changes', async () => {
        const projectDir = await tmp('battlestack-pull-pristine-')
        const tplV1 = await tmp('battlestack-pull-pristine-v1-')
        const tplV2 = await tmp('battlestack-pull-pristine-v2-')
        await writeTemplateFile(tplV1, 'a.ts', 'v1 content\n')
        await writeTemplateFile(tplV2, 'a.ts', 'v2 content\n')

        const registriesV1 = makeRegistries({ requiredFeatures: [fqid('test:feat-a')] })
        const featV1 = makeFileFeature('test:feat-a', '1.0.0', tplV1)
        registriesV1.features.register(featV1, origin)
        const ctx = scaffoldCtx(projectDir, registriesV1, [fqid('test:feat-a')])
        await featV1.execute(ctx)
        await writeManifest(ctx)

        // Simulate a CLI upgrade: fresh registries, same id/namespace so the fqid
        // matches, bumped version, reading from the new template dir.
        const registriesV2 = makeRegistries({ requiredFeatures: [fqid('test:feat-a')] })
        registriesV2.features.register(makeFileFeature('test:feat-a', '2.0.0', tplV2), origin)

        await runPull(projectDir, registriesV2)

        expect(await readFile(path.join(projectDir, 'a.ts'), 'utf8')).toBe('v2 content\n')
        const manifest = await readManifestRaw(projectDir)
        const rec = manifest.features.find((f) => f.id === fqid('test:feat-a'))!
        expect(rec.version).toBe('2.0.0')
    })

    it('CORE PROPERTY: never silently overwrites a file the user edited (hash mismatch)', async () => {
        const projectDir = await tmp('battlestack-pull-drift-')
        const tplV1 = await tmp('battlestack-pull-drift-v1-')
        const tplV2 = await tmp('battlestack-pull-drift-v2-')
        await writeTemplateFile(tplV1, 'a.ts', 'v1 content\n')
        await writeTemplateFile(tplV2, 'a.ts', 'v2 content\n')

        const registriesV1 = makeRegistries({ requiredFeatures: [fqid('test:feat-a')] })
        const featV1 = makeFileFeature('test:feat-a', '1.0.0', tplV1)
        registriesV1.features.register(featV1, origin)
        const ctx = scaffoldCtx(projectDir, registriesV1, [fqid('test:feat-a')])
        await featV1.execute(ctx)
        await writeManifest(ctx)

        // The user hand-edits after scaffold, so the hash no longer matches the record.
        await writeFile(path.join(projectDir, 'a.ts'), 'my custom edit\n', 'utf8')

        const registriesV2 = makeRegistries({ requiredFeatures: [fqid('test:feat-a')] })
        registriesV2.features.register(makeFileFeature('test:feat-a', '2.0.0', tplV2), origin)

        await runPull(projectDir, registriesV2) // default args: no --force, no --overwrite

        // The user's edit is untouched on disk.
        expect(await readFile(path.join(projectDir, 'a.ts'), 'utf8')).toBe('my custom edit\n')

        // The new version is staged for manual merge, out of the source tree.
        const staged = await readFile(path.join(projectDir, '.battlestack', 'pull', 'a.ts.new'), 'utf8')
        expect(staged).toBe('v2 content\n')
        expect(await exists(path.join(projectDir, '.battlestack', 'pull', 'a.ts.patch'))).toBe(true)
        // Never written beside the real file; that would break framework auto-scanners.
        expect(await exists(path.join(projectDir, 'a.ts.battlestack.new'))).toBe(false)

        // The manifest keeps the ORIGINAL v1 baseline hash, neither the new template's nor
        // the user's edit, so `doctor` still reports drift instead of re-baselining.
        const manifest = await readManifestRaw(projectDir)
        const rec = manifest.features.find((f) => f.id === fqid('test:feat-a'))!
        expect(rec.files['a.ts']).toBe(await hashFile(path.join(tplV1, 'a.ts')))
        // The version record still advances: only the FILE overwrite is drift-gated.
        expect(rec.version).toBe('2.0.0')
    })

    it('--force overwrites a drifted file but preserves the prior content as a staged .bak', async () => {
        const projectDir = await tmp('battlestack-pull-force-')
        const tplV1 = await tmp('battlestack-pull-force-v1-')
        const tplV2 = await tmp('battlestack-pull-force-v2-')
        await writeTemplateFile(tplV1, 'a.ts', 'v1 content\n')
        await writeTemplateFile(tplV2, 'a.ts', 'v2 content\n')

        const registriesV1 = makeRegistries({ requiredFeatures: [fqid('test:feat-a')] })
        const featV1 = makeFileFeature('test:feat-a', '1.0.0', tplV1)
        registriesV1.features.register(featV1, origin)
        const ctx = scaffoldCtx(projectDir, registriesV1, [fqid('test:feat-a')])
        await featV1.execute(ctx)
        await writeManifest(ctx)

        await writeFile(path.join(projectDir, 'a.ts'), 'my custom edit\n', 'utf8')

        const registriesV2 = makeRegistries({ requiredFeatures: [fqid('test:feat-a')] })
        registriesV2.features.register(makeFileFeature('test:feat-a', '2.0.0', tplV2), origin)

        await runPull(projectDir, registriesV2, { force: true })

        expect(await readFile(path.join(projectDir, 'a.ts'), 'utf8')).toBe('v2 content\n')
        const bak = await readFile(path.join(projectDir, '.battlestack', 'pull', 'a.ts.bak'), 'utf8')
        expect(bak).toBe('my custom edit\n')
    })
})

describe('battlestack pull: ownedByUser is inviolable', () => {
    it('CORE PROPERTY: a file already owned via `battlestack own` is never touched, even when its bytes still match the OLD template hash', async () => {
        const projectDir = await tmp('battlestack-pull-owned-')
        const tplV1 = await tmp('battlestack-pull-owned-v1-')
        const tplV2 = await tmp('battlestack-pull-owned-v2-')
        await writeTemplateFile(tplV1, 'a.ts', 'v1\n')
        await writeTemplateFile(tplV2, 'a.ts', 'v2\n')

        const registriesV1 = makeRegistries({ requiredFeatures: [fqid('test:feat-a')] })
        const featV1 = makeFileFeature('test:feat-a', '1.0.0', tplV1)
        registriesV1.features.register(featV1, origin)
        const ctx = scaffoldCtx(projectDir, registriesV1, [fqid('test:feat-a')])
        await featV1.execute(ctx)
        await writeManifest(ctx)

        // `battlestack own a.ts` via the real command, not a manual manifest edit.
        await withCwd(projectDir, () => ownCommand(defaultArgs({ positionals: ['own', 'a.ts'] }), silentLoader()))

        // Left as-is, so it still matches the OLD template's hash: precisely the case a
        // naive hash comparison calls "pristine, safe to overwrite".
        expect(await readFile(path.join(projectDir, 'a.ts'), 'utf8')).toBe('v1\n')

        const registriesV2 = makeRegistries({ requiredFeatures: [fqid('test:feat-a')] })
        registriesV2.features.register(makeFileFeature('test:feat-a', '2.0.0', tplV2), origin)

        await runPull(projectDir, registriesV2)

        expect(await readFile(path.join(projectDir, 'a.ts'), 'utf8')).toBe('v1\n')
        const manifest = await readManifestRaw(projectDir)
        const rec = manifest.features.find((f) => f.id === fqid('test:feat-a'))!
        expect(rec.ownedByUser).toEqual(['a.ts'])
        // No merge artifacts staged for an owned file; there is nothing to merge.
        expect(await exists(path.join(projectDir, '.battlestack', 'pull', 'a.ts.new'))).toBe(false)
    })

    it('CORE PROPERTY: a `structuralFiles()`-declared path is honored even though the ORIGINAL manifest predates that hook (seedOwnedFromStructural)', async () => {
        // A feature that GAINS `structuralFiles()` later, so the old manifest has no
        // `ownedByUser` entry: only `seedOwnedFromStructural` prevents a silent overwrite.
        const projectDir = await tmp('battlestack-pull-structural-')
        const tplV1 = await tmp('battlestack-pull-structural-v1-')
        const tplV2 = await tmp('battlestack-pull-structural-v2-')
        await writeTemplateFile(tplV1, 'a.ts', 'v1\n')
        await writeTemplateFile(tplV2, 'a.ts', 'v2\n')

        const registriesV1 = makeRegistries({ requiredFeatures: [fqid('test:feat-a')] })
        const featV1 = makeFileFeature('test:feat-a', '1.0.0', tplV1) // no structuralFiles yet
        registriesV1.features.register(featV1, origin)
        const ctx = scaffoldCtx(projectDir, registriesV1, [fqid('test:feat-a')])
        await featV1.execute(ctx)
        await writeManifest(ctx)

        // Sanity: the original manifest genuinely has no ownedByUser entry.
        const before = await readManifestRaw(projectDir)
        expect(before.features.find((f) => f.id === fqid('test:feat-a'))!.ownedByUser).toBeUndefined()
        // a.ts is still bit-for-bit the shipped v1 content: the exact "pristine" case
        // that would otherwise be safe to overwrite.

        const registriesV2 = makeRegistries({ requiredFeatures: [fqid('test:feat-a')] })
        registriesV2.features.register(
            makeFileFeature('test:feat-a', '2.0.0', tplV2, { structuralFiles: ['a.ts'] }),
            origin,
        )

        await runPull(projectDir, registriesV2)

        expect(await readFile(path.join(projectDir, 'a.ts'), 'utf8')).toBe('v1\n')
        const after = await readManifestRaw(projectDir)
        const rec = after.features.find((f) => f.id === fqid('test:feat-a'))!
        // The manifest self-heals: the path is now recorded as owned going forward.
        expect(rec.ownedByUser).toEqual(['a.ts'])
    })

    it('CORE PROPERTY: records ownership for a structural path that only becomes claimable after the update runs', async () => {
        // A `structuralFiles()` that claims only paths the feature has actually recorded, which is
        // what stops `pull` skipping a file it has never written (`classifyForUpdate` returns
        // `owned` before it tests `!exists(dest)`). That makes the hook context-dependent: it
        // returns nothing before `update()` populates the state, so seeding cannot persist
        // ownership and only the post-update pass can.
        const projectDir = await tmp('battlestack-pull-late-structural-')
        const tplV1 = await tmp('battlestack-pull-late-structural-v1-')
        const tplV2 = await tmp('battlestack-pull-late-structural-v2-')
        await writeTemplateFile(tplV1, 'kept.ts', 'v1\n')
        await writeTemplateFile(tplV2, 'kept.ts', 'v1\n')
        // Ships only in v2: absent from the project and from the old manifest.
        await writeTemplateFile(tplV2, 'branding.svg', '<svg><!-- shipped --></svg>\n')

        const registriesV1 = makeRegistries({ requiredFeatures: [fqid('test:feat-a')] })
        const featV1 = makeFileFeature('test:feat-a', '1.0.0', tplV1)
        registriesV1.features.register(featV1, origin)
        const ctx = scaffoldCtx(projectDir, registriesV1, [fqid('test:feat-a')])
        await featV1.execute(ctx)
        await writeManifest(ctx)

        const registriesV2 = makeRegistries({ requiredFeatures: [fqid('test:feat-a')] })
        const featV2 = makeFileFeature('test:feat-a', '2.0.0', tplV2)
        featV2.structuralFiles = (c) => {
            const recorded = (c.state['files:test:feat-a'] as Record<string, string> | undefined) ?? {}
            return ['branding.svg'].filter((rel) => rel in recorded)
        }
        registriesV2.features.register(featV2, origin)

        await runPull(projectDir, registriesV2)

        // Written, not silently skipped as pre-owned.
        expect(await readFile(path.join(projectDir, 'branding.svg'), 'utf8'))
            .toBe('<svg><!-- shipped --></svg>\n')
        const after = await readManifestRaw(projectDir)
        const rec = after.features.find((f) => f.id === fqid('test:feat-a'))!
        // And owned from now on, so the project replacing it is not reported as drift forever.
        expect(rec.ownedByUser).toEqual(['branding.svg'])
    })

    // `--overwrite` may still reset an owned file, but only behind a confirmation. The
    // hooks below strip CI env vars so a real runner cannot make these vacuously auto-yes.
    describe('--overwrite + an owned file: confirmation-gated, not silent', () => {
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

        async function setupOwnedFile(): Promise<{ projectDir: string, registriesV2: BattlestackRegistries }> {
            const projectDir = await tmp('battlestack-pull-overwrite-owned-')
            const tplV1 = await tmp('battlestack-pull-overwrite-owned-v1-')
            const tplV2 = await tmp('battlestack-pull-overwrite-owned-v2-')
            await writeTemplateFile(tplV1, 'a.ts', 'v1\n')
            await writeTemplateFile(tplV2, 'a.ts', 'v2\n')

            const registriesV1 = makeRegistries({ requiredFeatures: [fqid('test:feat-a')] })
            const featV1 = makeFileFeature('test:feat-a', '1.0.0', tplV1)
            registriesV1.features.register(featV1, origin)
            const ctx = scaffoldCtx(projectDir, registriesV1, [fqid('test:feat-a')])
            await featV1.execute(ctx)
            await writeManifest(ctx)
            await withCwd(projectDir, () => ownCommand(defaultArgs({ positionals: ['own', 'a.ts'] }), silentLoader()))

            const registriesV2 = makeRegistries({ requiredFeatures: [fqid('test:feat-a')] })
            registriesV2.features.register(makeFileFeature('test:feat-a', '2.0.0', tplV2), origin)
            return { projectDir, registriesV2 }
        }

        it('proceeds and overwrites the owned file once the user explicitly confirms', async () => {
            const { projectDir, registriesV2 } = await setupOwnedFile()

            prompts.inject([true]) // "Overwrite these owned files too?" → yes
            await runPull(projectDir, registriesV2, { overwrite: true, force: true, yes: false })

            expect(await readFile(path.join(projectDir, 'a.ts'), 'utf8')).toBe('v2\n')
        })

        it('CORE PROPERTY: aborts the ENTIRE pull with nothing written when the user declines', async () => {
            const { projectDir, registriesV2 } = await setupOwnedFile()

            prompts.inject([false]) // "Overwrite these owned files too?" → no
            await expect(
                runPull(projectDir, registriesV2, { overwrite: true, force: true, yes: false }),
            ).rejects.toThrow(/Aborted/)

            // The decline must be honored, not just logged.
            expect(await readFile(path.join(projectDir, 'a.ts'), 'utf8')).toBe('v1\n')
            // The abort must land BEFORE any writes, since the per-file path cannot
            // un-clobber. An unadvanced version record pins that it aborts atomically.
            const manifest = await readManifestRaw(projectDir)
            const rec = manifest.features.find((f) => f.id === fqid('test:feat-a'))!
            expect(rec.version).toBe('1.0.0')
        })

        it('never prompts under --yes: auto-confirms so existing scripts keep clobbering owned files unprompted', async () => {
            const { projectDir, registriesV2 } = await setupOwnedFile()

            // No `prompts.inject()` on purpose: if this reached the real prompt, `prompts`
            // throws rather than hangs, so a regressed auto-yes gate fails loudly.
            await runPull(projectDir, registriesV2, { overwrite: true, force: true, yes: true })

            expect(await readFile(path.join(projectDir, 'a.ts'), 'utf8')).toBe('v2\n')
        })
    })
})

describe('battlestack pull: rehydrating missing features (fqid defaultEnabledOptional)', () => {
    it('a template switch installs the NEW template\'s defaultEnabledOptional feature (already fqid-canonicalized)', async () => {
        const projectDir = await tmp('battlestack-pull-switch-')
        const tplA = await tmp('battlestack-pull-switch-a-')
        const tplB = await tmp('battlestack-pull-switch-b-')
        await writeTemplateFile(tplA, 'a.ts', 'a-content\n')
        await writeTemplateFile(tplB, 'b.ts', 'b-content\n')

        const registriesV1 = new BattlestackRegistries()
        registriesV1.frameworks.register({ id: FW, label: FW, supportedFeatures: [] }, origin)
        registriesV1.templates.register(
            { id: 'tpl-a', label: 'tpl-a', framework: FW, requiredFeatures: [fqid('test:feat-a')], optionalFeatures: [] },
            origin,
        )
        const featA = makeFileFeature('test:feat-a', '1.0.0', tplA)
        registriesV1.features.register(featA, origin)

        const ctx: RunContext = {
            projectName: path.basename(projectDir),
            projectDir,
            framework: registriesV1.frameworks.get(FW),
            template: registriesV1.templates.get('tpl-a'),
            enabledFeatures: new Set([fqid('test:feat-a')]),
            state: { packageManager: 'pnpm' },
            debug: false,
            dryRun: false,
            registries: registriesV1,
        }
        await featA.execute(ctx)
        await writeManifest(ctx)

        // Template B additionally has feat-b as a default-enabled OPTIONAL feature: the
        // fqid shape `finalizeRegistries` produces.
        const registriesV2 = new BattlestackRegistries()
        registriesV2.frameworks.register({ id: FW, label: FW, supportedFeatures: [] }, origin)
        registriesV2.templates.register(
            {
                id: 'tpl-a',
                label: 'tpl-a',
                framework: FW,
                requiredFeatures: [fqid('test:feat-a')],
                optionalFeatures: [],
            },
            origin,
        )
        registriesV2.templates.register(
            {
                id: 'tpl-b',
                label: 'tpl-b',
                framework: FW,
                requiredFeatures: [fqid('test:feat-a')],
                optionalFeatures: [fqid('test:feat-b')],
                defaultEnabledOptional: [fqid('test:feat-b')],
            },
            origin,
        )
        registriesV2.features.register(makeFileFeature('test:feat-a', '1.0.0', tplA), origin)
        registriesV2.features.register(makeFileFeature('test:feat-b', '1.0.0', tplB), origin)

        await runPull(projectDir, registriesV2, { template: 'tpl-b' })

        expect(await readFile(path.join(projectDir, 'b.ts'), 'utf8')).toBe('b-content\n')
        const manifest = await readManifestRaw(projectDir)
        expect(manifest.template).toBe('tpl-b')
        const rec = manifest.features.find((f) => f.id === fqid('test:feat-b'))!
        expect(rec).toBeDefined()
        expect(rec.files['b.ts']).toBeDefined()
    })

    it('a plain pull (no template switch) rehydrates a feature newly added to requiredFeatures', async () => {
        const projectDir = await tmp('battlestack-pull-rehydrate-')
        const tplA = await tmp('battlestack-pull-rehydrate-a-')
        const tplC = await tmp('battlestack-pull-rehydrate-c-')
        await writeTemplateFile(tplA, 'a.ts', 'a-content\n')
        await writeTemplateFile(tplC, 'c.ts', 'c-content\n')

        const registriesV1 = makeRegistries({ requiredFeatures: [fqid('test:feat-a')] })
        const featA = makeFileFeature('test:feat-a', '1.0.0', tplA)
        registriesV1.features.register(featA, origin)
        const ctx = scaffoldCtx(projectDir, registriesV1, [fqid('test:feat-a')])
        await featA.execute(ctx)
        await writeManifest(ctx)

        // Same template id, but it now requires feat-c too: a required feature added
        // between releases.
        const registriesV2 = makeRegistries({ requiredFeatures: [fqid('test:feat-a'), fqid('test:feat-c')] })
        registriesV2.features.register(makeFileFeature('test:feat-a', '1.0.0', tplA), origin)
        registriesV2.features.register(makeFileFeature('test:feat-c', '1.0.0', tplC), origin)

        await runPull(projectDir, registriesV2) // no --template

        expect(await readFile(path.join(projectDir, 'c.ts'), 'utf8')).toBe('c-content\n')
        const manifest = await readManifestRaw(projectDir)
        expect(manifest.features.find((f) => f.id === fqid('test:feat-c'))).toBeDefined()
    })
})

describe('battlestack pull: misc plumbing', () => {
    it('drops an orphaned feature (removed from the CLI) from the manifest without throwing', async () => {
        const projectDir = await tmp('battlestack-pull-orphan-')
        const tplA = await tmp('battlestack-pull-orphan-a-')
        const tplOrphan = await tmp('battlestack-pull-orphan-o-')
        await writeTemplateFile(tplA, 'a.ts', 'a-content\n')
        await writeTemplateFile(tplOrphan, 'o.ts', 'o-content\n')

        const registriesV1 = makeRegistries({ requiredFeatures: [fqid('test:feat-a')] })
        const featA = makeFileFeature('test:feat-a', '1.0.0', tplA)
        const featOrphan = makeFileFeature('test:feat-orphan', '1.0.0', tplOrphan)
        registriesV1.features.register(featA, origin)
        registriesV1.features.register(featOrphan, origin)
        const ctx = scaffoldCtx(projectDir, registriesV1, [fqid('test:feat-a'), fqid('test:feat-orphan')])
        await featA.execute(ctx)
        await featOrphan.execute(ctx)
        await writeManifest(ctx)

        // Pull-time registries never register feat-orphan, as if it were removed.
        const registriesV2 = makeRegistries({ requiredFeatures: [fqid('test:feat-a')] })
        registriesV2.features.register(makeFileFeature('test:feat-a', '1.0.0', tplA), origin)

        await expect(runPull(projectDir, registriesV2)).resolves.not.toThrow()

        const manifest = await readManifestRaw(projectDir)
        expect(manifest.features.find((f) => f.id === fqid('test:feat-orphan'))).toBeUndefined()
        // The orphan's file is left alone; pull only stops tracking it.
        expect(await readFile(path.join(projectDir, 'o.ts'), 'utf8')).toBe('o-content\n')
    })
})
