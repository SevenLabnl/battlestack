import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * END-TO-END upgrade of a project created under a PRIOR product name. Other tests cover
 * each migration in isolation; none proved they fire in concert off the real defaults.
 */
/** A placeholder on purpose: under test is that editing this one file suffices. */
const NEW_NAME = 'afterburner'
const OLD_NAME = 'battlestack'

vi.mock('../../core/src/constants/identity.js', () => ({
    CURRENT_NAME: NEW_NAME,
    PRIOR_NAMES: [OLD_NAME],
    ALL_NAMES: [NEW_NAME, OLD_NAME],
}))

const {
    CURRENT_NAME,
    MANIFEST_PATH,
    STATE_DIR,
    acquireProjectLock,
    findProjectRoot,
    readLocalState,
    readManifest,
    writeManifest,
} = await import('@battlestack/core')
const { ownCommand } = await import('../src/commands/own.js')
const { buildRegistries, defaultArgs, withCwd } = await import('./test-utils.js')

const OLD_DIR = `.${OLD_NAME}`
const NEW_DIR = `.${NEW_NAME}`

/** A file the legacy manifest tracks, so `own` has something to claim. */
const TRACKED = 'server/database/schema/users.ts'

let projectDir: string

/**
 * A project as an older CLI left it: state under the PRIOR name's dot-directory, plus the
 * siblings sharing it, because the contract is that they move together in one rename.
 */
async function seedLegacyProject(): Promise<void> {
    const state = path.join(projectDir, OLD_DIR)
    await mkdir(path.join(state, 'pull'), { recursive: true })
    await writeFile(
        path.join(state, 'manifest.json'),
        JSON.stringify({
            schemaVersion: 1,
            cliVersion: '2.3.8',
            framework: 'nuxt',
            template: 'nuxt-fullstack',
            packageManager: 'npm',
            projectName: path.basename(projectDir),
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z',
            features: [
                { id: 'nuxt:database', version: '1.0.0', files: { [TRACKED]: 'deadbeef' } },
                { id: 'shared:docker', version: '1.0.0', files: {} },
            ],
            optedOut: ['nuxt:fontawesome'],
        }, null, 4) + '\n',
        'utf8',
    )
    await writeFile(
        path.join(state, 'local.json'),
        JSON.stringify({ gateway: { enabled: true, hostname: `legacy.${OLD_NAME}.test` } }, null, 4) + '\n',
        'utf8',
    )
    await writeFile(path.join(state, 'pull', 'staged.diff'), 'staged pull artifact\n', 'utf8')
    // The tracked file itself, so `own`/`disown` can hash it.
    await mkdir(path.dirname(path.join(projectDir, TRACKED)), { recursive: true })
    await writeFile(path.join(projectDir, TRACKED), 'export const users = {}\n', 'utf8')
}

/** Run `battlestack own <TRACKED>` the way the CLI does: from inside the project. */
async function runOwn(): Promise<void> {
    await withCwd(projectDir, () =>
        ownCommand(defaultArgs({ positionals: ['own', TRACKED] }), undefined as never))
}

async function readJsonAt(rel: string): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(path.join(projectDir, rel), 'utf8')) as Record<string, unknown>
}

/**
 * Registries built the production way, ids authored BARE, so the STORED spelling differs.
 * Hand-assembled registries leave bare == fqid, a shape production never produces.
 */
function fixtures() {
    const feature = (id: string, label: string) => ({
        id,
        version: '1.0.0',
        label,
        stage: 'DATABASE' as const,
        async execute() {},
    })
    return buildRegistries({
        namespace: 'nuxt4',
        features: [feature('nuxt4:database', 'database'), feature('shared:docker', 'docker')],
        frameworks: [{
            id: 'nuxt4',
            label: 'Nuxt 4',
            supportedFeatures: ['nuxt4:database', 'shared:docker'],
        }],
        templates: [{
            id: 'nuxt4-fullstack',
            label: 'Fullstack',
            framework: 'nuxt4',
            requiredFeatures: ['nuxt4:database', 'shared:docker'],
            optionalFeatures: [],
        }],
    })
}

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-rename-e2e-'))
    await seedLegacyProject()
})

afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
})

describe('the rename mock itself', () => {
    // Guards the file's own premise: a mock that silently stopped applying would leave
    // every assertion below passing against the unrenamed constants.
    it('makes the product identity the new name, with the old one as a prior name', () => {
        expect(CURRENT_NAME).toBe(NEW_NAME)
        expect(STATE_DIR).toBe(NEW_DIR)
        expect(MANIFEST_PATH).toBe(`${NEW_DIR}/manifest.json`)
    })
})

describe('the fixture really is in production shape', () => {
    // Guard on the guard, as in `add.test.ts`: the fqid assertions below are vacuous
    // unless authored and stored spellings DIFFER. That is what let past id bugs ship.
    it('stores 3-segment fqids, not the authored bare ids', () => {
        const { registries } = fixtures()
        expect(registries.templates.get('nuxt4-fullstack').requiredFeatures).toEqual([
            'nuxt4:nuxt4:database',
            'nuxt4:shared:docker',
        ])
        expect(registries.frameworks.get('nuxt4').supportedFeatures).toEqual([
            'nuxt4:nuxt4:database',
            'nuxt4:shared:docker',
        ])
    })

    it('loads cleanly: an unexpected finalizeRegistries warning is a real signal', () => {
        expect(fixtures().warnings).toEqual([])
    })
})

describe('end-to-end upgrade of a prior-name project', () => {
    it('recognizes a prior-name project as a project, without mutating it', async () => {
        // Before anything migrates the project must still be FOUND, or every downstream
        // command falls through to scaffold dispatch and treats its name as a template.
        expect(await findProjectRoot(projectDir)).toBe(projectDir)
        // Read-only: `findProjectRoot` runs on every ancestor of every path a command
        // touches, so it must not adopt anything as a side effect.
        expect(await readdir(projectDir)).toContain(OLD_DIR)
        expect(await readdir(projectDir)).not.toContain(NEW_DIR)
    })

    it('finds it from a nested subdirectory too', async () => {
        const nested = path.join(projectDir, 'server', 'api', 'deep')
        await mkdir(nested, { recursive: true })
        expect(await findProjectRoot(nested)).toBe(projectDir)
    })

    it('adopts the whole prior-name state directory on the first real command', async () => {
        await runOwn()

        const entries = await readdir(projectDir)
        expect(entries).toContain(NEW_DIR)
        expect(entries).not.toContain(OLD_DIR)

        // Everything sharing the state directory moved in one rename. Relocating the
        // manifest alone would strand local state and staged pull artifacts.
        const migrated = await readdir(path.join(projectDir, NEW_DIR))
        expect(migrated.sort()).toEqual(['local.json', 'manifest.json', 'pull'])
        expect(
            await readFile(path.join(projectDir, NEW_DIR, 'pull', 'staged.diff'), 'utf8'),
        ).toBe('staged pull artifact\n')
    })

    it('reads local state written under the prior name', async () => {
        // Deliberately NOT preceded by another command: `own` would migrate the directory
        // as a side effect and this would pass with `readLocalState`'s migration deleted.
        const local = await readLocalState(projectDir)
        expect(local?.gateway?.hostname).toBe(`legacy.${OLD_NAME}.test`)
        expect(await readdir(projectDir)).not.toContain(OLD_DIR)
    })

    it('persists the legacy manifest migration to the new location', async () => {
        await runOwn()

        const manifest = await readJsonAt(`${NEW_DIR}/manifest.json`)
        // The domain bump and the directory adoption are independent migrations; both
        // landing in the same written file is the "in concert" property.
        expect(manifest.framework).toBe('nuxt4')
        expect((manifest.features as Array<{ id: string }>).map((f) => f.id)).toEqual([
            'nuxt4:database',
            'shared:docker',
        ])
        expect(manifest.optedOut).toEqual(['nuxt4:fontawesome'])
    })

    it('actually performed the command it was asked to perform', async () => {
        // The upgrade must not be the ONLY thing that happens. A migration that swallowed
        // the command would look identical to a successful one in every assertion above.
        await runOwn()
        const manifest = await readJsonAt(`${NEW_DIR}/manifest.json`)
        const record = (manifest.features as Array<{ id: string, ownedByUser?: string[] }>)
            .find((f) => f.id === 'nuxt4:database')
        expect(record?.ownedByUser).toEqual([TRACKED])
    })

    it('is idempotent: a second command leaves no prior-name directory behind', async () => {
        await runOwn()
        const afterFirst = await readFile(path.join(projectDir, NEW_DIR, 'manifest.json'), 'utf8')
        await runOwn()

        expect(await readdir(projectDir)).not.toContain(OLD_DIR)
        // `own` on an already-owned path is a no-op, so the bytes must not move either:
        // the manifest is committed, and a rewrite dirties the user's repo.
        expect(await readFile(path.join(projectDir, NEW_DIR, 'manifest.json'), 'utf8'))
            .toBe(afterFirst)
    })

    it('canonicalizes ids to fqids once the migrated project is written with registries', async () => {
        // `own` reads without registries. The next `writeManifest` WITH them must take ids
        // to fqids AND key its merge on them, or recorded hashes and flags are dropped.
        await runOwn()

        const { registries } = fixtures()
        const manifest = await readManifest(projectDir, registries)
        expect(manifest).not.toBeNull()

        await writeManifest({
            projectName: path.basename(projectDir),
            projectDir,
            framework: registries.frameworks.get('nuxt4'),
            template: registries.templates.get('nuxt4-fullstack'),
            enabledFeatures: new Set(['nuxt4:nuxt4:database', 'nuxt4:shared:docker']),
            state: { packageManager: 'npm' },
            debug: false,
            dryRun: false,
            registries,
        }, { cliVersion: '9.9.9' })

        const written = await readJsonAt(`${NEW_DIR}/manifest.json`)
        const records = written.features as Array<{ id: string, files: Record<string, string>, ownedByUser?: string[] }>
        expect(records.map((f) => f.id)).toEqual([
            'nuxt4:nuxt4:database',
            'nuxt4:shared:docker',
        ])
        // The upgrade must not lose the state the project already had.
        const db = records.find((f) => f.id === 'nuxt4:nuxt4:database')
        expect(db?.files[TRACKED]).toBe('deadbeef')
        expect(db?.ownedByUser).toEqual([TRACKED])
        // Asserted here, not after `own`, which preserves this field for free. Only
        // `writeManifest` rebuilds from scratch and could restamp it as newly created.
        expect(written.createdAt).toBe('2025-01-01T00:00:00.000Z')
    })

    it('takes the project lock in the new state directory, not the prior one', async () => {
        const release = await acquireProjectLock(projectDir, 'upgrade')
        try {
            expect(await readdir(projectDir)).not.toContain(OLD_DIR)
            const lock = JSON.parse(
                await readFile(path.join(projectDir, NEW_DIR, 'lock'), 'utf8'),
            ) as { pid: number, command: string }
            expect(lock.pid).toBe(process.pid)
            expect(lock.command).toBe('upgrade')
            // The manifest came along: the lock path must not be a fresh empty directory
            // that strands the real state.
            await expect(stat(path.join(projectDir, NEW_DIR, 'manifest.json'))).resolves.toBeDefined()
        } finally {
            await release()
        }
    })

    it('refuses a second concurrent lock on the same project', async () => {
        const release = await acquireProjectLock(projectDir, 'pull')
        try {
            await expect(acquireProjectLock(projectDir, 'bump')).rejects.toThrow(/already running/)
        } finally {
            await release()
        }
        // Released: the next command must get the lock, not inherit a permanent refusal.
        const second = await acquireProjectLock(projectDir, 'bump')
        await second()
    })
})
