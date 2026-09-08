import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyTemplateDirRecorded, reconcilePostFormat, snapshotTrackedHashes, updateFromTemplateDir } from '../src/utils/templates.js'
import { exists } from '../src/utils/fs.js'
import { BattlestackRegistries } from '../src/registry.js'
import { STAGE } from '../src/constants/stages.js'
import type { Feature, InstalledFeatureRecord } from '../src/types/feature.js'
import type { RunContext } from '../src/types/run-context.js'

const origin = { plugin: 'test-plugin', namespace: 'test' }

// `templates.ts` takes a plain `featureId` string and never consults the registry, so
// unlike other suites these fixtures need no registered `Feature`.
const registries = new BattlestackRegistries()
registries.frameworks.register({ id: 'tpl-test', label: 'tpl-test', supportedFeatures: [] }, origin)
registries.templates.register({
    id: 'tpl-test', label: 'tpl-test', framework: 'tpl-test', requiredFeatures: [], optionalFeatures: [],
}, origin)

let projectDir: string
let templateDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-tpl-test-proj-'))
    templateDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-tpl-test-src-'))
})

afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
    await rm(templateDir, { recursive: true, force: true })
})

function makeCtx(): RunContext {
    return {
        projectName: 'demo',
        projectDir,
        framework: registries.frameworks.get('tpl-test'),
        template: registries.templates.get('tpl-test'),
        enabledFeatures: new Set(['test:tpl']),
        state: { packageManager: 'pnpm' },
        debug: false,
        dryRun: false,
        registries,
    }
}

describe('copyTemplateDirRecorded', () => {
    it('copies tree and records hashes in ctx.state', async () => {
        await mkdir(path.join(templateDir, 'sub'), { recursive: true })
        await writeFile(path.join(templateDir, 'a.ts'), 'export const a = 1\n')
        await writeFile(path.join(templateDir, 'sub', 'b.ts'), 'export const b = 2\n')

        const ctx = makeCtx()
        await copyTemplateDirRecorded(ctx, 'test:tpl-copy', templateDir)

        const a = await readFile(path.join(projectDir, 'a.ts'), 'utf8')
        const b = await readFile(path.join(projectDir, 'sub', 'b.ts'), 'utf8')
        expect(a).toBe('export const a = 1\n')
        expect(b).toBe('export const b = 2\n')

        const recorded = ctx.state['files:test:tpl-copy'] as Record<string, string>
        expect(Object.keys(recorded)).toContain('a.ts')
        expect(Object.keys(recorded)).toContain(path.join('sub', 'b.ts'))
        expect(recorded['a.ts']).toMatch(/^[a-f0-9]{64}$/)
    })

    /**
     * Two features may deliberately ship the same rel (nuxt-ui's app shell, overwritten
     * by landing-shell). The overwrite must move every tracking feature's baseline to
     * the new bytes, or the earlier feature reports drift on every `doctor` and stages
     * merge artifacts on every `pull`, permanently.
     */
    it('re-baselines every feature tracking a preexisting file it overwrites', async () => {
        await writeFile(path.join(templateDir, 'shared.ts'), 'export const v = 2\n')
        const ctx = makeCtx()
        // The earlier feature's emit: file on disk, hash recorded under its id.
        const oldContent = 'export const v = 1\n'
        await writeFile(path.join(projectDir, 'shared.ts'), oldContent)
        const oldHash = createHash('sha256').update(oldContent).digest('hex')
        ctx.state['files:test:earlier'] = { 'shared.ts': oldHash, 'other.ts': 'unrelated-hash' }

        await copyTemplateDirRecorded(ctx, 'test:later', templateDir)

        const newHash = createHash('sha256').update('export const v = 2\n').digest('hex')
        expect(ctx.state['files:test:later']).toMatchObject({ 'shared.ts': newHash })
        const earlier = ctx.state['files:test:earlier'] as Record<string, string>
        expect(earlier['shared.ts']).toBe(newHash)
        // A rel the overwrite never touched keeps its baseline.
        expect(earlier['other.ts']).toBe('unrelated-hash')
    })

    it('never emits stray battlestack-merge artifacts even if committed into a template dir', async () => {
        await writeFile(path.join(templateDir, 'a.ts'), 'export const a = 1\n')
        // simulate a pull artifact accidentally committed into the template tree
        await writeFile(path.join(templateDir, 'a.ts.battlestack.new'), 'export const a = 2\n')
        await writeFile(path.join(templateDir, 'email-templates.ts.battlestack'), 'leaked\n')

        const ctx = makeCtx()
        await copyTemplateDirRecorded(ctx, 'test:tpl-copy-junk', templateDir)

        expect(await exists(path.join(projectDir, 'a.ts'))).toBe(true)
        expect(await exists(path.join(projectDir, 'a.ts.battlestack.new'))).toBe(false)
        expect(await exists(path.join(projectDir, 'email-templates.ts.battlestack'))).toBe(false)
    })
})

describe('snapshotTrackedHashes + reconcilePostFormat', () => {
    const sha = async (s: string) => {
        const { createHash } = await import('node:crypto')
        return createHash('sha256').update(s).digest('hex')
    }

    it('re-baselines a pristine file that formatting rewrote', async () => {
        const rel = 'fmt.ts'
        const before = 'export const x=1\n'
        const after = 'export const x = 1\n' // prettier output
        const ctx = makeCtx()
        await writeFile(path.join(projectDir, rel), before)
        const recordedHash = await sha(before)
        const tracked = [{ featureId: 't:fmt', recorded: { [rel]: recordedHash }, owned: new Set<string>() }]

        const pre = await snapshotTrackedHashes(ctx, tracked) // sees `before` == recorded
        await writeFile(path.join(projectDir, rel), after) // simulate prettier
        await reconcilePostFormat(ctx, tracked, pre)

        const recorded = ctx.state['files:t:fmt'] as Record<string, string>
        expect(recorded[rel]).toBe(await sha(after))
    })

    it('does NOT bless a file the user edited before formatting (real drift)', async () => {
        const rel = 'edited.ts'
        const recordedHash = await sha('shipped\n')
        const ctx = makeCtx()
        // on-disk already diverged from the baseline (a user edit)
        await writeFile(path.join(projectDir, rel), 'my custom edit\n')
        const tracked = [{ featureId: 't:edit', recorded: { [rel]: recordedHash }, owned: new Set<string>() }]

        const pre = await snapshotTrackedHashes(ctx, tracked) // sees edit != recorded
        await writeFile(path.join(projectDir, rel), 'my custom edit formatted\n')
        await reconcilePostFormat(ctx, tracked, pre)

        const recorded = ctx.state['files:t:edit'] as Record<string, string>
        expect(recorded[rel]).toBe(recordedHash) // baseline preserved → still drift in doctor
    })

    it('never re-baselines owned files', async () => {
        const rel = 'owned.ts'
        const recordedHash = await sha('orig\n')
        const ctx = makeCtx()
        await writeFile(path.join(projectDir, rel), 'orig\n')
        const tracked = [{ featureId: 't:own', recorded: { [rel]: recordedHash }, owned: new Set([rel]) }]

        const pre = await snapshotTrackedHashes(ctx, tracked)
        await writeFile(path.join(projectDir, rel), 'reformatted\n')
        await reconcilePostFormat(ctx, tracked, pre)

        const recorded = ctx.state['files:t:own'] as Record<string, string>
        expect(recorded[rel]).toBe(recordedHash)
    })

    it('preserves the rest of a feature\'s files when re-baselining one (no partial drop)', async () => {
        const ctx = makeCtx()
        const aHash = await sha('a=1\n')
        const bHash = await sha('b=1\n')
        await writeFile(path.join(projectDir, 'a.ts'), 'a=1\n')
        await writeFile(path.join(projectDir, 'b.ts'), 'b=1\n')
        const tracked = [{ featureId: 't:multi', recorded: { 'a.ts': aHash, 'b.ts': bHash }, owned: new Set<string>() }]

        const pre = await snapshotTrackedHashes(ctx, tracked)
        await writeFile(path.join(projectDir, 'a.ts'), 'a = 1\n') // only a.ts reformatted
        await reconcilePostFormat(ctx, tracked, pre)

        const recorded = ctx.state['files:t:multi'] as Record<string, string>
        expect(recorded['a.ts']).toBe(await sha('a = 1\n'))
        expect(recorded['b.ts']).toBe(bHash) // untouched file still tracked
    })

    it('skips files absent on disk', async () => {
        const ctx = makeCtx()
        const tracked = [{ featureId: 't:gone', recorded: { 'gone.ts': 'h' }, owned: new Set<string>() }]
        const pre = await snapshotTrackedHashes(ctx, tracked)
        await reconcilePostFormat(ctx, tracked, pre)
        const recorded = ctx.state['files:t:gone'] as Record<string, string> | undefined
        // seeded but never re-recorded
        expect(recorded?.['gone.ts']).toBe('h')
    })
})

describe('updateFromTemplateDir', () => {
    it('overwrites pristine files', async () => {
        const rel = 'a.ts'
        const original = 'export const a = 1\n'
        const updated = 'export const a = 2\n'

        // Set up: write original to template + project, capture hash
        await writeFile(path.join(templateDir, rel), original)
        await writeFile(path.join(projectDir, rel), original)
        const { createHash } = await import('node:crypto')
        const originalHash = createHash('sha256').update(original).digest('hex')

        // Bump template
        await writeFile(path.join(templateDir, rel), updated)

        const ctx = makeCtx()
        const prev: InstalledFeatureRecord = {
            id: 'test:tpl-update-pristine',
            version: '0.1.0',
            files: { [rel]: originalHash },
        }

        const report = await updateFromTemplateDir(ctx, 'test:tpl-update-pristine', templateDir, prev)

        expect(report.written).toContain(rel)
        expect(report.skipped).toEqual([])
        const onDisk = await readFile(path.join(projectDir, rel), 'utf8')
        expect(onDisk).toBe(updated)
    })

    it('stages .new + .patch under .battlestack/pull/ when user has drifted', async () => {
        const rel = 'a.ts'
        const original = 'export const a = 1\n'
        const userEdit = 'export const a = 1\n// custom\n'
        const updated = 'export const a = 2\n'

        await writeFile(path.join(templateDir, rel), original)
        await writeFile(path.join(projectDir, rel), userEdit)
        const { createHash } = await import('node:crypto')
        const originalHash = createHash('sha256').update(original).digest('hex')

        await writeFile(path.join(templateDir, rel), updated)

        const ctx = makeCtx()
        const prev: InstalledFeatureRecord = {
            id: 'test:tpl-update-drift',
            version: '0.1.0',
            files: { [rel]: originalHash },
        }

        const report = await updateFromTemplateDir(ctx, 'test:tpl-update-drift', templateDir, prev)

        expect(report.skipped).toContain(rel)
        expect(report.written).not.toContain(rel)

        // User file untouched
        const onDisk = await readFile(path.join(projectDir, rel), 'utf8')
        expect(onDisk).toBe(userEdit)

        // No artefacts written beside the real file (would break Nuxt/Nitro scan)
        expect(await exists(path.join(projectDir, rel + '.battlestack.new'))).toBe(false)
        expect(await exists(path.join(projectDir, rel + '.battlestack.patch'))).toBe(false)

        // Artefacts staged under .battlestack/pull/, out of the source tree
        const newContent = await readFile(path.join(projectDir, '.battlestack', 'pull', rel + '.new'), 'utf8')
        expect(newContent).toBe(updated)
        const patch = await readFile(path.join(projectDir, '.battlestack', 'pull', rel + '.patch'), 'utf8')
        expect(patch).toContain('-// custom')
        expect(patch).toContain('-export const a = 1')
        expect(patch).toContain('+export const a = 2')

        // A drifted file must stay tracked with its baseline carried forward, or doctor
        // forgets the user's edit.
        const recorded = ctx.state['files:test:tpl-update-drift'] as Record<string, string>
        expect(recorded[rel]).toBe(originalHash)
    })

    it('stops tracking a file the new version no longer ships (obsolete)', async () => {
        const keep = 'keep.ts'
        const gone = 'gone.ts'
        await writeFile(path.join(templateDir, keep), 'export const k = 1\n')
        await writeFile(path.join(projectDir, keep), 'export const k = 1\n')
        // `gone.ts` was tracked before but the template no longer ships it
        const goneContent = 'export const g = 1\n'
        await writeFile(path.join(projectDir, gone), goneContent)
        const { createHash } = await import('node:crypto')
        const sha = (s: string) => createHash('sha256').update(s).digest('hex')

        const ctx = makeCtx()
        const prev: InstalledFeatureRecord = {
            id: 'test:tpl-obsolete',
            version: '0.1.0',
            files: { [keep]: sha('export const k = 1\n'), [gone]: sha(goneContent) },
        }

        await updateFromTemplateDir(ctx, 'test:tpl-obsolete', templateDir, prev)

        const recorded = ctx.state['files:test:tpl-obsolete'] as Record<string, string>
        expect(recorded[keep]).toBeDefined()
        expect(recorded[gone]).toBeUndefined() // pruned from tracking
        // pristine obsolete file is also removed from disk
        expect(await exists(path.join(projectDir, gone))).toBe(false)
    })

    it('flags restoredDeleted when a tracked file the user deleted is restored', async () => {
        const rel = 'gone.ts'
        const content = 'export const gone = 1\n'
        await writeFile(path.join(templateDir, rel), content)
        const { createHash } = await import('node:crypto')
        const recordedHash = createHash('sha256').update(content).digest('hex')
        // file is tracked (recordedHash) but absent on disk: the user deleted it

        const ctx = makeCtx()
        const prev: InstalledFeatureRecord = {
            id: 'test:tpl-restore-deleted',
            version: '0.1.0',
            files: { [rel]: recordedHash },
        }

        const report = await updateFromTemplateDir(ctx, 'test:tpl-restore-deleted', templateDir, prev)

        expect(await readFile(path.join(projectDir, rel), 'utf8')).toBe(content)
        expect(report.restoredDeleted).toContain(rel)
    })

    it('does NOT flag restoredDeleted for a brand-new file (no recorded hash)', async () => {
        const rel = 'fresh.ts'
        await writeFile(path.join(templateDir, rel), 'export const fresh = 1\n')

        const ctx = makeCtx()
        const prev: InstalledFeatureRecord = {
            id: 'test:tpl-fresh-file',
            version: '0.1.0',
            files: {},
        }

        const report = await updateFromTemplateDir(ctx, 'test:tpl-fresh-file', templateDir, prev)
        expect(report.written).toContain(rel)
        expect(report.restoredDeleted ?? []).not.toContain(rel)
    })

    it('emits new files added by the new version', async () => {
        await writeFile(path.join(templateDir, 'new.ts'), 'export const newone = 1\n')

        const ctx = makeCtx()
        const prev: InstalledFeatureRecord = {
            id: 'test:tpl-update-new',
            version: '0.1.0',
            files: {}, // nothing was tracked previously
        }

        const report = await updateFromTemplateDir(ctx, 'test:tpl-update-new', templateDir, prev)

        expect(report.written).toContain('new.ts')
        const onDisk = await readFile(path.join(projectDir, 'new.ts'), 'utf8')
        expect(onDisk).toBe('export const newone = 1\n')
    })

    it('removes obsolete files when still pristine, keeps user-modified ones', async () => {
        // The new version drops both tracked files: pristine.ts should be removed,
        // modified.ts kept with a note.
        const pristineContent = 'pristine\n'
        const userContent = 'user-edited\n'
        const { createHash } = await import('node:crypto')
        const pristineHash = createHash('sha256').update(pristineContent).digest('hex')
        const userOriginalHash = createHash('sha256').update('user-original\n').digest('hex')

        await writeFile(path.join(projectDir, 'pristine.ts'), pristineContent)
        await writeFile(path.join(projectDir, 'modified.ts'), userContent)

        const ctx = makeCtx()
        const prev: InstalledFeatureRecord = {
            id: 'test:tpl-update-drop',
            version: '0.1.0',
            files: {
                'pristine.ts': pristineHash,
                'modified.ts': userOriginalHash,
            },
        }

        const report = await updateFromTemplateDir(ctx, 'test:tpl-update-drop', templateDir, prev)

        // Pristine file removed
        await expect(readFile(path.join(projectDir, 'pristine.ts'), 'utf8')).rejects.toThrow()
        // Modified file preserved
        const stillThere = await readFile(path.join(projectDir, 'modified.ts'), 'utf8')
        expect(stillThere).toBe(userContent)

        // Notes mention both
        expect(report.notes.some((n) => n.includes('pristine.ts'))).toBe(true)
        expect(report.notes.some((n) => n.includes('modified.ts'))).toBe(true)
    })
})

/**
 * The nuxt-ui/landing-shell shape: two features deliberately ship the same rels, the
 * later-ordered one's bytes win at scaffold, and both track the file. These suites
 * register real features (unlike the rest of this file) because the shared-file logic
 * reads the execution order and the other features' pre-seeded `files:` state maps —
 * exactly what `battlestack pull` provides.
 */
describe('updateFromTemplateDir: rels shared across features', () => {
    const REL = path.join('app', 'app.vue')
    const SHELL_CONTENT = '<template>landing shell</template>\n'

    const sharedOrigin = { plugin: 'shared-test-plugin', namespace: 'shared' }
    let sharedRegistries: BattlestackRegistries

    const sha = (s: string) => createHash('sha256').update(s).digest('hex')

    beforeEach(() => {
        sharedRegistries = new BattlestackRegistries()
        sharedRegistries.frameworks.register(
            { id: 'tpl-test', label: 'tpl-test', supportedFeatures: [] },
            sharedOrigin,
        )
        sharedRegistries.templates.register(
            { id: 'tpl-test', label: 'tpl-test', framework: 'tpl-test', requiredFeatures: [], optionalFeatures: [] },
            sharedOrigin,
        )
        const noop = async (): Promise<void> => {}
        // Mirrors production: the shell sits in an EARLIER stage but declares
        // `after: [ui]`, so the topo edge (not the stage sort) makes it run later.
        const ui: Feature = {
            id: 'tpl:ui', label: 'ui', version: '1.0.0', stage: STAGE.STYLING,
            frameworks: ['tpl-test'], execute: noop,
        }
        const shell: Feature = {
            id: 'tpl:shell', label: 'shell', version: '1.0.0', stage: STAGE.BASE_CONFIG,
            frameworks: ['tpl-test'], after: ['tpl:ui'], execute: noop,
        }
        sharedRegistries.features.register(ui, sharedOrigin)
        sharedRegistries.features.register(shell, sharedOrigin)
    })

    /** Pull-shaped ctx: enabled by fqid, `files:` maps pre-seeded by bare id. */
    function makeSharedCtx(seed: Record<string, Record<string, string>>): RunContext {
        const ctx: RunContext = {
            projectName: 'demo',
            projectDir,
            framework: sharedRegistries.frameworks.get('tpl-test'),
            template: sharedRegistries.templates.get('tpl-test'),
            enabledFeatures: new Set(['shared:tpl:ui', 'shared:tpl:shell']),
            state: { packageManager: 'pnpm' },
            debug: false,
            dryRun: false,
            registries: sharedRegistries,
        }
        for (const [bareId, files] of Object.entries(seed)) {
            ctx.state[`files:${bareId}`] = { ...files }
        }
        return ctx
    }

    it('does not emit a rel a later-ordered enabled feature also tracks (nuxt-ui-bump-only pull)', async () => {
        // ui's new template ships its minimal shell; disk holds the shell feature's bytes,
        // and (after scaffold-time re-baselining) BOTH features record those bytes.
        await mkdir(path.join(templateDir, 'app'), { recursive: true })
        await writeFile(path.join(templateDir, REL), '<template>minimal ui shell v2</template>\n')
        await mkdir(path.join(projectDir, 'app'), { recursive: true })
        await writeFile(path.join(projectDir, REL), SHELL_CONTENT)
        const shellHash = sha(SHELL_CONTENT)

        const ctx = makeSharedCtx({
            'tpl:ui': { [REL]: shellHash },
            'tpl:shell': { [REL]: shellHash },
        })
        const prev: InstalledFeatureRecord = {
            id: 'shared:tpl:ui', // manifest records carry the fqid
            version: '0.9.0',
            files: { [REL]: shellHash },
        }

        const report = await updateFromTemplateDir(ctx, 'tpl:ui', templateDir, prev)

        // The landing page survives, is still tracked by both, and was not staged as a conflict.
        expect(await readFile(path.join(projectDir, REL), 'utf8')).toBe(SHELL_CONTENT)
        expect(report.written).not.toContain(REL)
        expect(report.skipped).not.toContain(REL)
        expect(report.notes.join('\n')).toContain('tpl:shell')
        expect((ctx.state['files:tpl:ui'] as Record<string, string>)[REL]).toBe(shellHash)
        expect((ctx.state['files:tpl:shell'] as Record<string, string>)[REL]).toBe(shellHash)
        // Skipped-but-shipped means NOT obsolete: the file must not be deleted.
        expect(await exists(path.join(projectDir, REL))).toBe(true)
    })

    // Neither feature bumped: the deferral is the ONLY path that touches the rel, so it
    // must also repair a baseline that is already stale (e.g. recorded before shared-rel
    // re-baselining existed) — otherwise `doctor` reports drift forever and even
    // `pull --force` defers instead of repairing.
    it('repairs an already-stale baseline while deferring to the later owner', async () => {
        await mkdir(path.join(templateDir, 'app'), { recursive: true })
        await writeFile(path.join(templateDir, REL), '<template>minimal ui shell v2</template>\n')
        await mkdir(path.join(projectDir, 'app'), { recursive: true })
        await writeFile(path.join(projectDir, REL), SHELL_CONTENT)
        const shellHash = sha(SHELL_CONTENT)
        const staleHash = sha('<template>old ui shell</template>\n')

        const ctx = makeSharedCtx({
            'tpl:ui': { [REL]: staleHash },
            'tpl:shell': { [REL]: shellHash },
        })
        const prev: InstalledFeatureRecord = {
            id: 'shared:tpl:ui',
            version: '0.9.0',
            files: { [REL]: staleHash },
        }

        await updateFromTemplateDir(ctx, 'tpl:ui', templateDir, prev)

        // Disk matches the later owner's baseline (pristine from its perspective), so the
        // stale record moves to the on-disk bytes and the drift is healed.
        expect((ctx.state['files:tpl:ui'] as Record<string, string>)[REL]).toBe(shellHash)
        expect(await readFile(path.join(projectDir, REL), 'utf8')).toBe(SHELL_CONTENT)
    })

    it('does not bless user drift while deferring: only the later owner may classify it', async () => {
        await mkdir(path.join(templateDir, 'app'), { recursive: true })
        await writeFile(path.join(templateDir, REL), '<template>minimal ui shell v2</template>\n')
        await mkdir(path.join(projectDir, 'app'), { recursive: true })
        const userContent = '<template>user rewrote this</template>\n'
        await writeFile(path.join(projectDir, REL), userContent)
        const shellHash = sha(SHELL_CONTENT)
        const staleHash = sha('<template>old ui shell</template>\n')

        const ctx = makeSharedCtx({
            'tpl:ui': { [REL]: staleHash },
            'tpl:shell': { [REL]: shellHash },
        })
        const prev: InstalledFeatureRecord = {
            id: 'shared:tpl:ui',
            version: '0.9.0',
            files: { [REL]: staleHash },
        }

        await updateFromTemplateDir(ctx, 'tpl:ui', templateDir, prev)

        // Disk diverges from the later owner's baseline: real drift, both records stay put.
        expect((ctx.state['files:tpl:ui'] as Record<string, string>)[REL]).toBe(staleHash)
        expect((ctx.state['files:tpl:shell'] as Record<string, string>)[REL]).toBe(shellHash)
        expect(await readFile(path.join(projectDir, REL), 'utf8')).toBe(userContent)
    })

    it('re-baselines the earlier feature when the later one rewrites a shared pristine rel', async () => {
        // shell-bump-only pull: shell's update overwrites the shared file; ui's carried
        // baseline must follow, or ui reports drift (and stages conflicts) forever.
        const v1 = '<template>landing shell v1</template>\n'
        const v2 = '<template>landing shell v2</template>\n'
        await mkdir(path.join(templateDir, 'app'), { recursive: true })
        await writeFile(path.join(templateDir, REL), v2)
        await mkdir(path.join(projectDir, 'app'), { recursive: true })
        await writeFile(path.join(projectDir, REL), v1)

        const ctx = makeSharedCtx({
            'tpl:ui': { [REL]: sha(v1) },
            'tpl:shell': { [REL]: sha(v1) },
        })
        const prev: InstalledFeatureRecord = {
            id: 'shared:tpl:shell',
            version: '0.9.0',
            files: { [REL]: sha(v1) },
        }

        const report = await updateFromTemplateDir(ctx, 'tpl:shell', templateDir, prev)

        expect(report.written).toContain(REL)
        expect(await readFile(path.join(projectDir, REL), 'utf8')).toBe(v2)
        expect((ctx.state['files:tpl:shell'] as Record<string, string>)[REL]).toBe(sha(v2))
        expect((ctx.state['files:tpl:ui'] as Record<string, string>)[REL]).toBe(sha(v2))
    })

    it('never deletes an obsolete rel that another enabled feature still tracks', async () => {
        // ui's new version stops shipping the shared rel. It is pristine by ui's records,
        // but the shell still ships it — only ui's tracking entry may go.
        await writeFile(path.join(templateDir, 'other.ts'), 'export const o = 1\n')
        await mkdir(path.join(projectDir, 'app'), { recursive: true })
        await writeFile(path.join(projectDir, REL), SHELL_CONTENT)
        const shellHash = sha(SHELL_CONTENT)

        const ctx = makeSharedCtx({
            'tpl:ui': { [REL]: shellHash },
            'tpl:shell': { [REL]: shellHash },
        })
        const prev: InstalledFeatureRecord = {
            id: 'shared:tpl:ui',
            version: '0.9.0',
            files: { [REL]: shellHash },
        }

        await updateFromTemplateDir(ctx, 'tpl:ui', templateDir, prev)

        expect(await readFile(path.join(projectDir, REL), 'utf8')).toBe(SHELL_CONTENT)
        // Dropped from ui's records (keyed by the BARE id even though prev.id is the fqid)…
        expect((ctx.state['files:tpl:ui'] as Record<string, string>)[REL]).toBeUndefined()
        // …while the shell's tracking entry is untouched.
        expect((ctx.state['files:tpl:shell'] as Record<string, string>)[REL]).toBe(shellHash)
    })
})

// Bytes that do not survive a utf8 round-trip: 0x89 opens every PNG, and 0x80/0xFF
// are invalid UTF-8 continuation bytes. `Buffer.from(...).toString('utf8')` turns each
// into U+FFFD, so a mangling write path is detectable rather than merely suspected.
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x80, 0xff, 0x00, 0x01])
const PNG_BYTES_V2 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xfe, 0x81, 0x02, 0x03])

function sha256Of(buf: Buffer | string): string {
    return createHash('sha256').update(buf).digest('hex')
}

describe('updateFromTemplateDir: binary assets', () => {
    it('rewrites a pristine binary asset byte-for-byte, not as mangled utf8', async () => {
        const rel = path.join('public', 'icon-192.png')
        await mkdir(path.join(templateDir, 'public'), { recursive: true })
        await mkdir(path.join(projectDir, 'public'), { recursive: true })
        await writeFile(path.join(projectDir, rel), PNG_BYTES)
        await writeFile(path.join(templateDir, rel), PNG_BYTES_V2)

        const ctx = makeCtx()
        const prev: InstalledFeatureRecord = {
            id: 'test:tpl-bin-pristine',
            version: '0.1.0',
            files: { [rel]: sha256Of(PNG_BYTES) },
        }

        const report = await updateFromTemplateDir(ctx, 'test:tpl-bin-pristine', templateDir, prev)

        expect(report.written).toContain(rel)
        const onDisk = await readFile(path.join(projectDir, rel))
        expect(onDisk.equals(PNG_BYTES_V2)).toBe(true)
        // The recorded hash must be of the real bytes, or the next run reports false drift.
        const recorded = ctx.state['files:test:tpl-bin-pristine'] as Record<string, string>
        expect(recorded[rel]).toBe(sha256Of(PNG_BYTES_V2))
    })

    it('overwrites a binary asset byte-for-byte under --overwrite', async () => {
        const rel = path.join('public', 'favicon.ico')
        await mkdir(path.join(templateDir, 'public'), { recursive: true })
        await mkdir(path.join(projectDir, 'public'), { recursive: true })
        // User-drifted AND owned: `--overwrite` ignores both, so this is the one path
        // that can still reach our icons.
        await writeFile(path.join(projectDir, rel), Buffer.from([0x00, 0xc3, 0x28]))
        await writeFile(path.join(templateDir, rel), PNG_BYTES)

        const ctx = makeCtx()
        ctx.state.overwrite = true
        const prev: InstalledFeatureRecord = {
            id: 'test:tpl-bin-overwrite',
            version: '0.1.0',
            files: { [rel]: 'stale-hash' },
            ownedByUser: [rel],
        }

        await updateFromTemplateDir(ctx, 'test:tpl-bin-overwrite', templateDir, prev)

        const onDisk = await readFile(path.join(projectDir, rel))
        expect(onDisk.equals(PNG_BYTES)).toBe(true)
    })

    it('stages a drifted binary asset as .new only, with no textual .patch', async () => {
        const rel = path.join('public', 'icon-512.png')
        await mkdir(path.join(templateDir, 'public'), { recursive: true })
        await mkdir(path.join(projectDir, 'public'), { recursive: true })
        const userEdit = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xaa, 0xbb])
        await writeFile(path.join(projectDir, rel), userEdit)
        await writeFile(path.join(templateDir, rel), PNG_BYTES_V2)

        const ctx = makeCtx()
        const prev: InstalledFeatureRecord = {
            id: 'test:tpl-bin-drift',
            version: '0.1.0',
            files: { [rel]: sha256Of(PNG_BYTES) },
        }

        const report = await updateFromTemplateDir(ctx, 'test:tpl-bin-drift', templateDir, prev)

        expect(report.skipped).toContain(rel)
        // User's asset untouched.
        expect((await readFile(path.join(projectDir, rel))).equals(userEdit)).toBe(true)
        // `.new` staged with real bytes...
        const staged = await readFile(path.join(projectDir, '.battlestack', 'pull', rel + '.new'))
        expect(staged.equals(PNG_BYTES_V2)).toBe(true)
        // ...and no line diff of binary noise.
        expect(await exists(path.join(projectDir, '.battlestack', 'pull', rel + '.patch'))).toBe(false)
        expect(report.notes.join('\n')).toContain('binary asset')
    })

    it('still writes a text file as text (the binary branch must not swallow everything)', async () => {
        const rel = path.join('public', 'robots.txt')
        await mkdir(path.join(templateDir, 'public'), { recursive: true })
        await mkdir(path.join(projectDir, 'public'), { recursive: true })
        const original = 'User-Agent: *\nDisallow: /\n'
        const updated = 'User-Agent: *\nAllow: /\n'
        await writeFile(path.join(projectDir, rel), 'User-Agent: *\n# edited\n')
        await writeFile(path.join(templateDir, rel), updated)

        const ctx = makeCtx()
        const prev: InstalledFeatureRecord = {
            id: 'test:tpl-text-drift',
            version: '0.1.0',
            files: { [rel]: sha256Of(original) },
        }

        const report = await updateFromTemplateDir(ctx, 'test:tpl-text-drift', templateDir, prev)

        const patch = await readFile(path.join(projectDir, '.battlestack', 'pull', rel + '.patch'), 'utf8')
        expect(patch).toContain('+Allow: /')
        expect(report.notes.join('\n')).not.toContain('binary asset')
    })
})
