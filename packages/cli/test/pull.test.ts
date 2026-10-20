import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
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
    readManifest,
    renameProject,
    silentLoader,
    storeBase,
    STAGE,
    updateFromTemplateDir,
    writeManifest,
    writeRecorded,
    type Feature,
    type ParsedArgs,
    type ProjectManifest,
    type Provenance,
    type RunContext,
} from '@battlestack/core'
import { buildRegistries, defaultArgs, withCwd, withCwdCapture } from './test-utils.js'

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
    opts: { structuralFiles?: string[], stage?: Feature['stage'] } = {},
): Feature {
    return {
        id: bareId,
        label: bareId,
        version,
        stage: opts.stage ?? STAGE.STYLING,
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

    it('CORE PROPERTY: an owned file written through writeRecorded by an update that ignores prev is left alone', async () => {
        const projectDir = await tmp('battlestack-pull-owned-recorded-')
        const makeFeature = (version: string, content: string): Feature => ({
            id: 'test:feat-docker',
            label: 'test:feat-docker',
            version,
            stage: STAGE.STYLING,
            // A structural path recorded after update must not displace the user's own entry.
            structuralFiles: () => ['branding.svg'],
            async execute(ctx) {
                await writeRecorded(ctx, 'test:feat-docker', 'Dockerfile', content)
            },
            async update(ctx) {
                await writeRecorded(ctx, 'test:feat-docker', 'Dockerfile', content)
                return { written: ['Dockerfile'], skipped: [], notes: [] }
            },
        })

        const registriesV1 = makeRegistries({ requiredFeatures: [fqid('test:feat-docker')] })
        const featV1 = makeFeature('1.0.0', 'FROM node:22\nRUN a\n')
        registriesV1.features.register(featV1, origin)
        const ctx = scaffoldCtx(projectDir, registriesV1, [fqid('test:feat-docker')])
        await featV1.execute(ctx)
        await writeManifest(ctx)

        await withCwd(projectDir, () => ownCommand(defaultArgs({ positionals: ['own', 'Dockerfile'] }), silentLoader()))
        const edited = 'FROM node:22\nRUN mine\n'
        await writeFile(path.join(projectDir, 'Dockerfile'), edited, 'utf8')

        const registriesV2 = makeRegistries({ requiredFeatures: [fqid('test:feat-docker')] })
        registriesV2.features.register(makeFeature('2.0.0', 'FROM node:24\nRUN a\n'), origin)

        process.exitCode = undefined
        await runPull(projectDir, registriesV2)

        expect(await readFile(path.join(projectDir, 'Dockerfile'), 'utf8')).toBe(edited)
        expect(await exists(path.join(projectDir, '.battlestack', 'pull', 'Dockerfile.new'))).toBe(false)
        expect(process.exitCode).toBeUndefined()
        const rec = (await readManifestRaw(projectDir)).features.find((f) => f.id === fqid('test:feat-docker'))!
        expect(rec.version).toBe('2.0.0')
        expect(rec.ownedByUser).toContain('Dockerfile')
        process.exitCode = undefined
    })

    it('CORE PROPERTY: a path owned under one feature is left alone by every other feature that writes it', async () => {
        const projectDir = await tmp('battlestack-pull-owned-shared-')
        const ownerTpl = await tmp('battlestack-pull-owned-shared-owner-')
        const otherV1 = await tmp('battlestack-pull-owned-shared-v1-')
        const otherV2 = await tmp('battlestack-pull-owned-shared-v2-')
        await writeTemplateFile(ownerTpl, 'shared.ts', 'v1\n')
        await writeTemplateFile(otherV1, 'other.ts', 'other\n')
        await writeTemplateFile(otherV2, 'other.ts', 'other\n')
        await writeTemplateFile(otherV2, 'shared.ts', 'v2\n')

        // The owner runs first, so the other feature does not defer the shared path to it.
        const ids = [fqid('test:feat-owner'), fqid('test:feat-other')]
        const registriesV1 = makeRegistries({ requiredFeatures: ids })
        const owner = makeFileFeature('test:feat-owner', '1.0.0', ownerTpl, { stage: STAGE.BASE_CONFIG })
        const otherV1Feature = makeFileFeature('test:feat-other', '1.0.0', otherV1)
        registriesV1.features.register(owner, origin)
        registriesV1.features.register(otherV1Feature, origin)
        const ctx = scaffoldCtx(projectDir, registriesV1, ids)
        await owner.execute(ctx)
        await otherV1Feature.execute(ctx)
        await writeManifest(ctx)

        // The shape an older `own` left behind: both features track the path, only one owns it.
        const manifest = await readManifestRaw(projectDir)
        const sharedHash = await hashFile(path.join(projectDir, 'shared.ts'))
        manifest.features.find((f) => f.id === fqid('test:feat-owner'))!.ownedByUser = ['shared.ts']
        manifest.features.find((f) => f.id === fqid('test:feat-other'))!.files['shared.ts'] = sharedHash
        await writeFile(path.join(projectDir, MANIFEST_PATH), JSON.stringify(manifest, null, 2), 'utf8')
        const edited = 'mine\n'
        await writeFile(path.join(projectDir, 'shared.ts'), edited, 'utf8')

        const registriesV2 = makeRegistries({ requiredFeatures: ids })
        registriesV2.features.register(makeFileFeature('test:feat-owner', '1.0.0', ownerTpl, { stage: STAGE.BASE_CONFIG }), origin)
        registriesV2.features.register(makeFileFeature('test:feat-other', '2.0.0', otherV2), origin)

        process.exitCode = undefined
        await runPull(projectDir, registriesV2)

        expect(await readFile(path.join(projectDir, 'shared.ts'), 'utf8')).toBe(edited)
        expect(await exists(path.join(projectDir, '.battlestack', 'pull', 'shared.ts.new'))).toBe(false)
        expect(process.exitCode).toBeUndefined()
        const after = await readManifestRaw(projectDir)
        expect(after.features.find((f) => f.id === fqid('test:feat-other'))!.version).toBe('2.0.0')
        process.exitCode = undefined
    })

    it('retires a moved template through real ownership and version-gated pulls without data loss', async () => {
        const projectDir = await tmp('battlestack-pull-owned-retirement-')
        const tplV1 = await tmp('battlestack-pull-owned-retirement-v1-')
        const tplV2 = await tmp('battlestack-pull-owned-retirement-v2-')
        const featureId = 'test:retired-policy'
        // A root-level owned path keeps this retirement test independent of separator normalization.
        const ownedRel = 'password-policy.ts'
        const pristineRel = path.join('server', 'utils', 'unused.ts')
        const modifiedRel = path.join('server', 'utils', 'custom-policy.ts')
        const newRel = path.join('shared', 'utils', 'password-policy.ts')
        const oldContent = 'export const policy = 1\n'
        const newContent = 'export const policy = 2\n'
        const customContent = 'export const custom = true\n'
        await writeTemplateFile(tplV1, ownedRel, oldContent)
        await writeTemplateFile(tplV1, pristineRel, 'obsolete\n')
        await writeTemplateFile(tplV1, modifiedRel, 'original\n')
        await writeTemplateFile(tplV2, newRel, newContent)

        // Author bare ids and let the production finalizer resolve the catalog.
        const registriesFor = (feature: Feature): BattlestackRegistries => {
            const built = buildRegistries({
                namespace: NAMESPACE,
                frameworks: [{ id: FW, label: FW, supportedFeatures: [featureId] }],
                features: [feature],
                templates: [{
                    id: TPL,
                    label: TPL,
                    framework: FW,
                    requiredFeatures: [featureId],
                    optionalFeatures: [],
                }],
            })
            expect(built.warnings).toEqual([])
            return built.registries
        }
        const featV1 = makeFileFeature(featureId, '1.0.0', tplV1)
        const registriesV1 = registriesFor(featV1)
        const ctx = scaffoldCtx(projectDir, registriesV1, registriesV1.templates.get(TPL).requiredFeatures)
        await featV1.execute(ctx)
        await writeManifest(ctx)
        await withCwd(projectDir, () =>
            ownCommand(defaultArgs({ positionals: ['own', ownedRel] }), silentLoader()))
        await writeFile(path.join(projectDir, modifiedRel), customContent, 'utf8')

        let updateCalls = 0
        const featV2 = makeFileFeature(featureId, '2.0.0', tplV2)
        featV2.update = async (updateCtx, prev) => {
            updateCalls++
            return updateFromTemplateDir(updateCtx, featureId, tplV2, prev)
        }
        const registriesV2 = registriesFor(featV2)
        await runPull(projectDir, registriesV2)

        expect(updateCalls).toBe(1)
        expect(await readFile(path.join(projectDir, ownedRel), 'utf8')).toBe(oldContent)
        expect(await exists(path.join(projectDir, pristineRel))).toBe(false)
        expect(await readFile(path.join(projectDir, modifiedRel), 'utf8')).toBe(customContent)
        expect(await readFile(path.join(projectDir, newRel), 'utf8')).toBe(newContent)
        const manifest = await readManifestRaw(projectDir)
        const rec = manifest.features.find((f) => f.id === registriesV2.features.get(featureId).fqid)!
        expect(rec.version).toBe('2.0.0')
        expect(rec.files).toEqual({ [newRel]: await hashFile(path.join(tplV2, newRel)) })
        expect(rec.ownedByUser).toEqual([ownedRel])
        expect(await exists(path.join(projectDir, '.battlestack', 'pull', ownedRel + '.new'))).toBe(false)

        const manifestBytes = await readFile(path.join(projectDir, MANIFEST_PATH), 'utf8')
        await runPull(projectDir, registriesV2)
        // Same-version default pull is genuinely gated, not an accidental re-update.
        expect(updateCalls).toBe(1)
        expect(await readFile(path.join(projectDir, MANIFEST_PATH), 'utf8')).toBe(manifestBytes)
        await runPull(projectDir, registriesV2, { force: true })
        expect(updateCalls).toBe(2)
        expect(await readFile(path.join(projectDir, ownedRel), 'utf8')).toBe(oldContent)
        expect(await readFile(path.join(projectDir, modifiedRel), 'utf8')).toBe(customContent)
        expect(await readFile(path.join(projectDir, newRel), 'utf8')).toBe(newContent)
        expect(await exists(path.join(projectDir, pristineRel))).toBe(false)
        expect(await readManifestRaw(projectDir)).toEqual(manifest)
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

describe('battlestack pull: a file moving to a later feature', () => {
    // Mirrors nuxt4:vitest (NAMING) handing test/e2e/api/auth.test.ts to nuxt4:auth (AUTH).
    const movedRel = path.join('test', 'e2e', 'moved.test.ts')
    const movedContent = 'export const moved = true\n'
    // The new owner sorts first by id, as nuxt4:auth does before nuxt4:vitest, while its stage runs later.
    const FROM = 'test:z-from'
    const TO = 'test:a-to'

    async function setup(
        enabledBare: string[],
        newContent = movedContent,
        ids = { from: FROM, to: TO },
    ): Promise<{ projectDir: string, registriesV2: BattlestackRegistries }> {
        const projectDir = await tmp('battlestack-pull-moved-')
        const fromV1 = await tmp('battlestack-pull-moved-from-v1-')
        const fromV2 = await tmp('battlestack-pull-moved-from-v2-')
        const toV1 = await tmp('battlestack-pull-moved-to-v1-')
        const toV2 = await tmp('battlestack-pull-moved-to-v2-')
        await writeTemplateFile(fromV1, movedRel, movedContent)
        await writeTemplateFile(fromV1, 'from.ts', 'from\n')
        await writeTemplateFile(fromV2, 'from.ts', 'from\n')
        await writeTemplateFile(toV1, 'to.ts', 'to\n')
        await writeTemplateFile(toV2, 'to.ts', 'to\n')
        await writeTemplateFile(toV2, movedRel, newContent)

        const required = enabledBare.map(fqid)
        const registriesV1 = makeRegistries({ requiredFeatures: required })
        const v1 = [
            makeFileFeature(ids.from, '1.0.0', fromV1, { stage: STAGE.NAMING }),
            makeFileFeature(ids.to, '1.0.0', toV1, { stage: STAGE.AUTH }),
        ].filter((f) => enabledBare.includes(f.id))
        for (const f of v1) registriesV1.features.register(f, origin)
        const ctx = scaffoldCtx(projectDir, registriesV1, required)
        for (const f of v1) await f.execute(ctx)
        await writeManifest(ctx)

        const registriesV2 = makeRegistries({ requiredFeatures: required })
        registriesV2.features.register(makeFileFeature(ids.from, '1.1.0', fromV2, { stage: STAGE.NAMING }), origin)
        registriesV2.features.register(makeFileFeature(ids.to, '1.1.0', toV2, { stage: STAGE.AUTH }), origin)
        return { projectDir, registriesV2 }
    }

    const filesOf = (manifest: ProjectManifest, bareId: string): Record<string, string> | undefined =>
        manifest.features.find((f) => f.id === fqid(bareId))?.files

    it('keeps a pristine file and hands its record to the new owner', async () => {
        const { projectDir, registriesV2 } = await setup([FROM, TO])
        await runPull(projectDir, registriesV2)

        expect(await readFile(path.join(projectDir, movedRel), 'utf8')).toBe(movedContent)
        const manifest = await readManifestRaw(projectDir)
        expect(Object.keys(filesOf(manifest, FROM) ?? {})).not.toContain(movedRel)
        expect(Object.keys(filesOf(manifest, TO) ?? {})).toContain(movedRel)
    })

    it('writes the new owner\'s changed version when the old owner updates first', async () => {
        const ids = { from: 'test:a-from', to: 'test:z-to' }
        const changed = 'export const moved = "v2"\n'
        const { projectDir, registriesV2 } = await setup([ids.from, ids.to], changed, ids)
        await withCwdCapture(projectDir, () => pullCommand(args(), silentLoader(), registriesV2))
        process.exitCode = undefined

        expect(await readFile(path.join(projectDir, movedRel), 'utf8')).toBe(changed)
        expect(Object.keys(filesOf(await readManifestRaw(projectDir), ids.to) ?? {})).toContain(movedRel)
    })

    it('does not delete and rewrite the file when the old owner updates first', async () => {
        const ids = { from: 'test:a-from', to: 'test:z-to' }
        const { projectDir, registriesV2 } = await setup([ids.from, ids.to], movedContent, ids)
        const lines = await withCwdCapture(projectDir, () => pullCommand(args(), silentLoader(), registriesV2))
        process.exitCode = undefined

        expect(await readFile(path.join(projectDir, movedRel), 'utf8')).toBe(movedContent)
        expect(lines.join('\n')).not.toContain('removed obsolete file')
        expect(Object.keys(filesOf(await readManifestRaw(projectDir), ids.to) ?? {})).toContain(movedRel)
    })

    it('writes the new owner\'s version when the move also changed the file', async () => {
        const changed = 'export const moved = "v2"\n'
        const { projectDir, registriesV2 } = await setup([FROM, TO], changed)
        await runPull(projectDir, registriesV2)

        expect(await readFile(path.join(projectDir, movedRel), 'utf8')).toBe(changed)
        const manifest = await readManifestRaw(projectDir)
        expect(Object.keys(filesOf(manifest, FROM) ?? {})).not.toContain(movedRel)
        expect(Object.keys(filesOf(manifest, TO) ?? {})).toContain(movedRel)
        expect(await exists(path.join(projectDir, '.battlestack', 'pull', `${movedRel}.patch`))).toBe(false)
    })

    it('CORE PROPERTY: never deletes the user\'s edits to the moved file', async () => {
        const { projectDir, registriesV2 } = await setup([FROM, TO])
        const edited = 'export const moved = "edited"\n'
        await writeFile(path.join(projectDir, movedRel), edited, 'utf8')
        await runPull(projectDir, registriesV2)

        expect(await readFile(path.join(projectDir, movedRel), 'utf8')).toBe(edited)
    })

    it('removes the pristine file from a project without the new owner', async () => {
        const { projectDir, registriesV2 } = await setup([FROM])
        await runPull(projectDir, registriesV2)

        expect(await exists(path.join(projectDir, movedRel))).toBe(false)
        expect(Object.keys(filesOf(await readManifestRaw(projectDir), FROM) ?? {})).not.toContain(movedRel)
    })
})

describe('battlestack pull: a schema change ships with its migration', () => {
    // Production applies only committed SQL, so a schema file pull rewrote needs a migration.
    // The stand-in `db:generate` writes a SQL file like drizzle-kit does, so the real
    // `<pm> run db:generate` path runs without drizzle-kit.
    const schemaRel = path.join('server', 'database', 'schema', 'sessions.ts')
    const sqlRel = path.join('server', 'database', 'migrations', '0001_new_index.sql')
    const writesSql = `node -e "require('fs').mkdirSync('server/database/migrations',{recursive:true});require('fs').writeFileSync('server/database/migrations/0001_new_index.sql','')"`
    // drizzle-kit without a TTY on a rename prompt: prints, writes nothing, exits 0.
    const promptsWithoutTty = `node -e "console.error('Interactive prompts require a TTY terminal')"`

    async function setup(
        v2: { schema: string, other: string },
        dbGenerate = writesSql,
        { featureId = 'nuxt4:database', schema = schemaRel } = {},
    ): Promise<{ projectDir: string, registriesV2: BattlestackRegistries }> {
        const projectDir = await tmp('battlestack-pull-schema-')
        const tplV1 = await tmp('battlestack-pull-schema-v1-')
        const tplV2 = await tmp('battlestack-pull-schema-v2-')
        await writeTemplateFile(tplV1, schema, 'v1 schema\n')
        await writeTemplateFile(tplV1, 'other.ts', 'v1\n')
        await writeTemplateFile(tplV2, schema, v2.schema)
        await writeTemplateFile(tplV2, 'other.ts', v2.other)
        await writeFile(
            path.join(projectDir, 'package.json'),
            JSON.stringify({ scripts: { 'db:generate': dbGenerate } }),
        )

        const registriesFor = (tplDir: string, version: string): BattlestackRegistries => buildRegistries({
            namespace: 'nuxt4',
            frameworks: [{ id: FW, label: FW, supportedFeatures: [featureId] }],
            features: [makeFileFeature(featureId, version, tplDir, { stage: STAGE.DATABASE })],
            templates: [{ id: TPL, label: TPL, framework: FW, requiredFeatures: [featureId], optionalFeatures: [] }],
        }).registries
        const registriesV1 = registriesFor(tplV1, '1.0.0')
        const database = registriesV1.features.get(featureId)
        const ctx = scaffoldCtx(projectDir, registriesV1, [database.fqid])
        await database.execute(ctx)
        await writeManifest(ctx)
        return { projectDir, registriesV2: registriesFor(tplV2, '1.1.0') }
    }

    async function pull(projectDir: string, registries: BattlestackRegistries, overrides: Partial<ParsedArgs> = {}): Promise<{ lines: string[], exitCode: typeof process.exitCode, report: string }> {
        process.exitCode = undefined
        const lines = await withCwdCapture(projectDir, () => pullCommand(args(overrides), silentLoader(), registries))
        const exitCode = process.exitCode
        process.exitCode = undefined
        const reportPath = path.join(projectDir, '.battlestack', 'pull', 'REPORT.md')
        const report = await exists(reportPath) ? await readFile(reportPath, 'utf8') : ''
        return { lines, exitCode, report }
    }
    const generated = (projectDir: string) => exists(path.join(projectDir, sqlRel))

    it('runs db:generate when the pull rewrote a schema file, and names the new migration', async () => {
        const { projectDir, registriesV2 } = await setup({ schema: 'v2 schema\n', other: 'v1\n' })
        const { lines, exitCode } = await pull(projectDir, registriesV2)

        expect(await readFile(path.join(projectDir, schemaRel), 'utf8')).toBe('v2 schema\n')
        expect(await generated(projectDir)).toBe(true)
        expect(lines.some((l) => l.includes('generated 0001_new_index.sql'))).toBe(true)
        expect(exitCode).toBeUndefined()
    })

    it.each([
        ['--skip-install', { skipInstall: true }, writesSql],
        ['a failing db:generate', {}, 'node -e "process.exit(1)"'],
        ['a db:generate that exits 0 without writing SQL', {}, promptsWithoutTty],
    ])('reports db:generate as still to do on %s, and the pull still completes', async (_, overrides, dbGenerate) => {
        const { projectDir, registriesV2 } = await setup({ schema: 'v2 schema\n', other: 'v1\n' }, dbGenerate)
        const { lines, exitCode, report } = await pull(projectDir, registriesV2, overrides)

        expect(await generated(projectDir)).toBe(false)
        expect(lines.some((l) => l.includes('Schema changed: generated'))).toBe(false)
        expect(report).toContain('pnpm run db:generate')
        expect(exitCode).toBe(2)
        expect((await readManifestRaw(projectDir)).features[0].version).toBe('1.1.0')
    })

    it('passes on what drizzle-kit said, with a hint, when it stopped at a prompt', async () => {
        const { projectDir, registriesV2 } = await setup({ schema: 'v2 schema\n', other: 'v1\n' }, promptsWithoutTty)
        const { report } = await pull(projectDir, registriesV2)

        expect(report).toContain('Interactive prompts require a TTY terminal')
        expect(report).toContain('run it in a terminal')
    })

    it('does not generate while an edited schema file still waits for the user\'s merge', async () => {
        const { projectDir, registriesV2 } = await setup({ schema: 'v2 schema\n', other: 'v1\n' })
        await writeFile(path.join(projectDir, schemaRel), 'my own schema\n')
        const { exitCode, report } = await pull(projectDir, registriesV2)

        expect(await readFile(path.join(projectDir, schemaRel), 'utf8')).not.toBe('v2 schema\n')
        expect(await generated(projectDir)).toBe(false)
        expect(report).toContain('Schema files still need your merge')
        expect(report).toContain('server/database/schema/sessions.ts')
        expect(exitCode).toBe(2)
    })

    it('generates nothing when the schema bytes are unchanged, though the update reports the file', async () => {
        // The bump changes only `other.ts`; the schema is still reported as written (converged).
        const { projectDir, registriesV2 } = await setup({ schema: 'v1 schema\n', other: 'v2\n' })
        const { lines, report } = await pull(projectDir, registriesV2)

        expect(await readFile(path.join(projectDir, 'other.ts'), 'utf8')).toBe('v2\n')
        expect(await generated(projectDir)).toBe(false)
        expect(lines.some((l) => l.includes('Schema changed'))).toBe(false)
        expect(report).not.toContain('db:generate')
    })

    it.each([
        ['drizzle-kit finds nothing to migrate', {}, `node -e "console.log('No schema changes, nothing to migrate')"`],
        // Split strings: pnpm echoes the command to stderr, which must not match on its own.
        ['drizzle-kit finds nothing to migrate behind a warning', {}, `node -e "console.log('No schema' + ' changes, nothing to migrate');process.stderr.write('(node) Deprecation' + 'Warning: something')"`],
        ['the changed file is not one drizzle-kit reads', { schema: path.join('server', 'database', 'schema', 'README.md') }, writesSql],
        ['nuxt4:database is not enabled', { featureId: 'nuxt4:other' }, writesSql],
    ])('reports nothing to do when %s', async (_, opts, dbGenerate) => {
        const { projectDir, registriesV2 } = await setup({ schema: 'v2 schema\n', other: 'v1\n' }, dbGenerate, opts)
        const { exitCode, report } = await pull(projectDir, registriesV2)

        expect(await generated(projectDir)).toBe(false)
        expect(report).not.toContain('db:generate')
        expect(exitCode).toBeUndefined()
    })
})

describe('battlestack pull: misc plumbing', () => {
    it('keeps the record of a feature whose plugin did not load, and flags the pull', async () => {
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
        expect(process.exitCode).toBe(2)
        process.exitCode = undefined

        const manifest = await readManifestRaw(projectDir)
        // A missing plugin must not unmanage its files: the record survives untouched.
        expect(manifest.features.find((f) => f.id === fqid('test:feat-orphan'))?.files).toEqual({ 'o.ts': expect.any(String) })
        expect(await readFile(path.join(projectDir, 'o.ts'), 'utf8')).toBe('o-content\n')
    })
})

describe('battlestack pull --allow-dirty', () => {
    it('leaves an uncommitted edit to a tracked file exactly as it was', async () => {
        const { execFileSync } = await import('node:child_process')
        const projectDir = await tmp('battlestack-pull-dirty-')
        const tplDir = await tmp('battlestack-pull-dirty-tpl-')
        await writeTemplateFile(tplDir, 'a.ts', 'scaffold\n')
        const git = (...a: string[]) => execFileSync('git', a, {
            cwd: projectDir,
            stdio: 'ignore',
            env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
        })

        const v1 = makeRegistries({ requiredFeatures: [fqid('test:feat-a')] })
        const featV1 = makeFileFeature('test:feat-a', '1.0.0', tplDir)
        v1.features.register(featV1, origin)
        const ctx = scaffoldCtx(projectDir, v1, [fqid('test:feat-a')])
        await featV1.execute(ctx)
        await writeManifest(ctx)
        await writeFile(path.join(projectDir, 'a.ts'), 'committed edit\n')
        git('init', '-q')
        git('add', '-A')
        git('commit', '-q', '-m', 'init')
        await writeFile(path.join(projectDir, 'a.ts'), 'uncommitted edit\n')

        // v2 touches only b.ts; a.ts stays recorded by the feature.
        const v2 = makeRegistries({ requiredFeatures: [fqid('test:feat-a')] })
        v2.features.register({
            ...makeFileFeature('test:feat-a', '2.0.0', tplDir),
            async update(c) {
                await writeRecorded(c, 'test:feat-a', 'b.ts', 'new\n')
                return { written: ['b.ts'], skipped: [], notes: [] }
            },
        }, origin)

        await runPull(projectDir, v2, { allowDirty: true, format: false, skipInstall: true })
        process.exitCode = undefined
        expect(await readFile(path.join(projectDir, 'a.ts'), 'utf8')).toBe('uncommitted edit\n')
    })
})

describe('battlestack pull: reporting writes a feature did not report', () => {
    async function setup(prefix: string, v1Content: string): Promise<string> {
        const projectDir = await tmp(prefix)
        const tplDir = await tmp(`${prefix}tpl-`)
        await writeTemplateFile(tplDir, 'a.ts', v1Content)
        const v1 = makeRegistries({ requiredFeatures: [fqid('test:feat-a')] })
        const featV1 = makeFileFeature('test:feat-a', '1.0.0', tplDir)
        v1.features.register(featV1, origin)
        const ctx = scaffoldCtx(projectDir, v1, [fqid('test:feat-a')])
        await featV1.execute(ctx)
        await writeManifest(ctx)
        return projectDir
    }

    function v2Writing(content: string): BattlestackRegistries {
        const v2 = makeRegistries({ requiredFeatures: [fqid('test:feat-a')] })
        v2.features.register({
            ...makeFileFeature('test:feat-a', '2.0.0', '/nonexistent'),
            // Writes through the drift-aware writer but returns a report without it.
            async update(c) {
                await writeRecorded(c, 'test:feat-a', 'a.ts', content)
                return { written: [], skipped: [], notes: [] }
            },
        }, origin)
        return v2
    }

    it('counts a merge in the feature line', async () => {
        const base = 'one\ntwo\nthree\nfour\nfive\n'
        const projectDir = await setup('battlestack-pull-count-', base)
        await storeBase(projectDir, Buffer.from(base))
        await writeFile(path.join(projectDir, 'a.ts'), base.replace('one', 'one, edited'))

        const lines = await withCwdCapture(projectDir, () => pullCommand(args({ skipInstall: true }), silentLoader(), v2Writing(base.replace('five', 'five, upstream'))))
        process.exitCode = undefined
        expect(await readFile(path.join(projectDir, 'a.ts'), 'utf8')).toBe('one, edited\ntwo\nthree\nfour\nfive, upstream\n')
        expect(lines.join('\n')).toMatch(/test:feat-a: 1 merged/)
    })

    it('lists a deleted file it restored in the report', async () => {
        const projectDir = await setup('battlestack-pull-restored-', 'v1\n')
        await rm(path.join(projectDir, 'a.ts'))

        await withCwdCapture(projectDir, () => pullCommand(args({ skipInstall: true }), silentLoader(), v2Writing('v2\n')))
        process.exitCode = undefined
        expect(await readFile(path.join(projectDir, 'a.ts'), 'utf8')).toBe('v2\n')
        expect(await readFile(path.join(projectDir, '.battlestack/pull/REPORT.md'), 'utf8')).toMatch(/## New files[\s\S]*- `a\.ts`/)
    })
})

describe('battlestack pull: the project name', () => {
    // The name is rendered into compose projects, hostnames, secrets and image names, so a
    // pull that takes it from the wrong place, or never re-renders it, ships the wrong one.
    const FEATURE = 'test:named'
    let updates = 0

    function makeNamedFeature(version: string): Feature {
        async function render(ctx: RunContext): Promise<string> {
            const dir = await tmp('battlestack-pull-named-tpl-')
            await writeTemplateFile(dir, 'compose.txt', `name: ${ctx.projectName}\n`)
            await writeTemplateFile(dir, 'routes.txt', `host: ${ctx.projectName}.localhost\n`)
            return dir
        }
        return {
            id: FEATURE,
            label: 'named',
            version,
            stage: STAGE.STYLING,
            async execute(ctx) {
                await copyTemplateDirRecorded(ctx, FEATURE, await render(ctx))
            },
            async update(ctx, prev) {
                updates++
                return updateFromTemplateDir(ctx, FEATURE, await render(ctx), prev)
            },
        }
    }

    function registriesAt(version: string): BattlestackRegistries {
        const registries = makeRegistries({ requiredFeatures: [fqid(FEATURE)] })
        registries.features.register(makeNamedFeature(version), origin)
        return registries
    }

    /** Scaffolds `my-app`, then moves it to a directory named `demo`, as a clone into `demo` would. */
    async function scaffoldThenMove(): Promise<string> {
        const parent = await tmp('battlestack-pull-named-')
        const original = path.join(parent, 'my-app')
        await mkdir(original)
        const registries = registriesAt('1.0.0')
        const ctx = scaffoldCtx(original, registries, [fqid(FEATURE)])
        await registries.features.get(FEATURE).execute(ctx)
        await writeManifest(ctx)
        const moved = path.join(parent, 'demo')
        await rename(original, moved)
        return moved
    }

    async function pullCapturing(projectDir: string, registries: BattlestackRegistries): Promise<string> {
        const lines = await withCwdCapture(projectDir, () => pullCommand(args(), silentLoader(), registries))
        return lines.join('\n')
    }

    beforeEach(() => {
        updates = 0
    })

    it('renders the recorded name, not the directory name, in a checkout under another name', async () => {
        const projectDir = await scaffoldThenMove()
        await pullCapturing(projectDir, registriesAt('2.0.0'))

        expect(updates).toBe(1)
        expect(await readFile(path.join(projectDir, 'compose.txt'), 'utf8')).toBe('name: my-app\n')
        const manifest = await readManifestRaw(projectDir)
        expect(manifest.projectName).toBe('my-app')
        expect(manifest.previousNames).toBeUndefined()
    })

    it('re-renders after `rename` at an unchanged version, keeps edited files, and lists what still names the old one', async () => {
        const projectDir = await scaffoldThenMove()
        await writeFile(path.join(projectDir, 'routes.txt'), 'host: my-app.example.com\n', 'utf8')
        const registries = registriesAt('1.0.0')
        await renameProject(projectDir, (await readManifest(projectDir, registries))!, 'shop')

        const out = await pullCapturing(projectDir, registries)

        expect(updates).toBe(1)
        expect(await readFile(path.join(projectDir, 'compose.txt'), 'utf8')).toBe('name: shop\n')
        // CORE PROPERTY: a rename is no licence to overwrite an edited file.
        expect(await readFile(path.join(projectDir, 'routes.txt'), 'utf8')).toBe('host: my-app.example.com\n')
        expect(await exists(path.join(projectDir, '.battlestack', 'pull', 'routes.txt.patch'))).toBe(true)
        expect(out).toContain('still name the project my-app')
        expect(out).toContain('routes.txt')
        expect(out).not.toMatch(/•.*compose\.txt/)

        const manifest = await readManifestRaw(projectDir)
        expect(manifest.projectName).toBe('shop')
        expect(manifest.previousNames).toEqual(['my-app'])
        expect(manifest.renderedName).toBeUndefined()

        // Settled: the next same-version pull is a no-op again.
        await pullCapturing(projectDir, registries)
        expect(updates).toBe(1)
    })

    it('keeps the rename pending when a feature fails to re-render', async () => {
        const projectDir = await scaffoldThenMove()
        const registries = makeRegistries({ requiredFeatures: [fqid(FEATURE)] })
        registries.features.register({
            ...makeNamedFeature('1.0.0'),
            failureIsNonFatal: true,
            async update() {
                throw new Error('boom')
            },
        }, origin)
        await renameProject(projectDir, (await readManifest(projectDir, registries))!, 'shop')

        await pullCapturing(projectDir, registries)
        process.exitCode = undefined

        expect((await readManifestRaw(projectDir)).renderedName).toBe('my-app')
    })

    it('keeps the rename pending when a feature\'s plugin did not load', async () => {
        const projectDir = await scaffoldThenMove()
        await renameProject(projectDir, (await readManifest(projectDir, registriesAt('1.0.0')))!, 'shop')
        const withoutPlugin = makeRegistries({ requiredFeatures: [] })

        await pullCapturing(projectDir, withoutPlugin)
        process.exitCode = undefined

        expect((await readManifestRaw(projectDir)).renderedName).toBe('my-app')
    })

    it('a dry-run after `rename` writes nothing and leaves the rename pending', async () => {
        const projectDir = await scaffoldThenMove()
        const registries = registriesAt('1.0.0')
        await renameProject(projectDir, (await readManifest(projectDir, registries))!, 'shop')

        await withCwd(projectDir, () => pullCommand(args({ dryRun: true }), silentLoader(), registries))

        expect(await readFile(path.join(projectDir, 'compose.txt'), 'utf8')).toBe('name: my-app\n')
        expect((await readManifestRaw(projectDir)).renderedName).toBe('my-app')
    })
})
