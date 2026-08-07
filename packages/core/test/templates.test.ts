import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyTemplateDirRecorded, reconcilePostFormat, snapshotTrackedHashes, updateFromTemplateDir } from '../src/utils/templates.js'
import { exists } from '../src/utils/fs.js'
import { BattlestackRegistries } from '../src/registry.js'
import type { InstalledFeatureRecord } from '../src/types/feature.js'
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
