import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `init`'s manifest-already-exists guard under a rename. `MANIFEST_PATH` uses the CURRENT
 * identity, so on a project named EARLIER it found nothing and dropped features `pull` needs.
 */
const NEW_NAME = 'afterburner'
const OLD_NAME = 'battlestack'

vi.mock('../../core/src/constants/identity.js', () => ({
    CURRENT_NAME: NEW_NAME,
    PRIOR_NAMES: [OLD_NAME],
    ALL_NAMES: [NEW_NAME, OLD_NAME],
}))

const { initCommand } = await import('../../preset-nuxt4/src/commands/init.js')
const { buildRegistries, defaultArgs } = await import('./test-utils.js')

const OLD_DIR = `.${OLD_NAME}`
const NEW_DIR = `.${NEW_NAME}`

/** Tracked by the seeded project's auth feature, which `init` must not drop. */
const AUTH_FILE = 'server/utils/auth.ts'

let projectDir: string

/**
 * Registries built the production way, since hand-assembled ones leave bare == fqid. The
 * template requires ONLY database, so a project that also had `auth` loses it unguarded.
 */
function built() {
    const feature = (id: string) => ({
        id,
        version: '1.0.0',
        label: id,
        stage: 'DATABASE' as const,
        async execute() {},
    })
    return buildRegistries({
        namespace: 'nuxt4',
        features: [feature('nuxt4:database'), feature('nuxt4:auth')],
        frameworks: [{
            id: 'nuxt4',
            label: 'Nuxt 4',
            supportedFeatures: ['nuxt4:database', 'nuxt4:auth'],
        }],
        templates: [{
            id: 'nuxt4-minimal',
            label: 'Minimal',
            framework: 'nuxt4',
            requiredFeatures: ['nuxt4:database'],
            optionalFeatures: [],
        }],
    })
}

function registries() {
    return built().registries
}

/** Shared CLI arg builder + the flags `init` needs to run unprompted. */
function args(over: Record<string, unknown> = {}) {
    return defaultArgs({
        yes: true,
        skipInstall: true,
        cwd: projectDir,
        framework: 'nuxt4',
        template: 'nuxt4-minimal',
        packageManager: 'pnpm',
        ...over,
    })
}

async function runInit(over: Record<string, unknown> = {}): Promise<unknown> {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
        await initCommand({
            args: [],
            parsed: args(over),
            loader: undefined as never,
            registries: registries(),
        })
        return null
    } catch (err) {
        return err
    } finally {
        log.mockRestore()
    }
}

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-init-rename-'))
    const state = path.join(projectDir, OLD_DIR)
    await mkdir(state, { recursive: true })
    await writeFile(path.join(state, 'manifest.json'), JSON.stringify({
        schemaVersion: 1,
        cliVersion: '2.3.8',
        framework: 'nuxt4',
        template: 'nuxt4-fullstack',
        packageManager: 'npm',
        projectName: path.basename(projectDir),
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        features: [
            { id: 'nuxt4:nuxt4:database', version: '1.0.0', files: { 'server/db.ts': 'DBHASH' } },
            {
                id: 'nuxt4:nuxt4:auth',
                version: '1.0.0',
                files: { [AUTH_FILE]: 'AUTHHASH' },
                ownedByUser: [AUTH_FILE],
            },
        ],
    }, null, 4) + '\n', 'utf8')
})

describe('the rename mock premise', () => {
    // Without this, a mock that stopped applying would leave every assertion below
    // testing the unrenamed constants.
    it('puts the product on the new name with the old one as prior', async () => {
        const { CURRENT_NAME, PRIOR_NAMES } = await import('@battlestack/core')
        expect(CURRENT_NAME).toBe(NEW_NAME)
        expect(PRIOR_NAMES).toEqual([OLD_NAME])
    })
})

describe('fixture shape', () => {
    // Guard on the guard: ids must reach the fqid spelling the real loader produces, or
    // the assertions below run on a shape production never generates.
    it('canonicalizes authored ids to 3-segment fqids like the real loader', () => {
        const r = registries()
        expect(r.templates.get('nuxt4-minimal').requiredFeatures).toEqual(['nuxt4:nuxt4:database'])
        expect(r.frameworks.get('nuxt4').supportedFeatures).toEqual([
            'nuxt4:nuxt4:database',
            'nuxt4:nuxt4:auth',
        ])
    })

    it('loads cleanly: an unexpected finalizeRegistries warning is a real signal', () => {
        expect(built().warnings).toEqual([])
    })
})

describe('init on a project scaffolded under a prior product name', () => {
    it('refuses to overwrite the manifest without --force', async () => {
        const err = await runInit()
        expect(err).toBeInstanceOf(Error)
        expect((err as Error).message).toMatch(/already exists/)
    })

    it('leaves every tracked feature intact when it refuses', async () => {
        await runInit()
        // The guard is only useful if it fires BEFORE anything is written: the manifest
        // must still carry both features with the hashes and flags `pull` depends on.
        const dirs = await readdir(projectDir)
        expect(dirs).toContain(NEW_DIR)
        expect(dirs).not.toContain(OLD_DIR)
        const m = JSON.parse(
            await readFile(path.join(projectDir, NEW_DIR, 'manifest.json'), 'utf8'),
        ) as { packageManager: string, features: Array<{ id: string, files: Record<string, string>, ownedByUser?: string[] }> }
        expect(m.features.map((f) => f.id).sort()).toEqual([
            'nuxt4:nuxt4:auth',
            'nuxt4:nuxt4:database',
        ])
        const auth = m.features.find((f) => f.id === 'nuxt4:nuxt4:auth')
        expect(auth?.files[AUTH_FILE]).toBe('AUTHHASH')
        expect(auth?.ownedByUser).toEqual([AUTH_FILE])
        expect(m.packageManager).toBe('npm')
    })

    it('still adopts the prior-name directory even though it refuses to write', async () => {
        // Adopting only relocates already-correct bytes, and must happen for the guard
        // to see the manifest at all.
        await runInit()
        expect(await readdir(projectDir)).toEqual([NEW_DIR])
    })

    it('still honours --force, so the escape hatch survives the fix', async () => {
        const err = await runInit({ force: true })
        expect(err).toBeNull()
        const m = JSON.parse(
            await readFile(path.join(projectDir, NEW_DIR, 'manifest.json'), 'utf8'),
        ) as { features: Array<{ id: string }> }
        // --force is documented as an overwrite, so the synthesized manifest describes the
        // template's feature set. Asserted so the fix cannot creep into blocking that.
        expect(m.features.map((f) => f.id)).toEqual(['nuxt4:nuxt4:database'])
    })

    it('still adopts a fresh directory into project mode', async () => {
        // The fix must not turn `init`'s actual purpose into an error.
        await rm(path.join(projectDir, OLD_DIR), { recursive: true, force: true })
        const err = await runInit()
        expect(err).toBeNull()
        const m = JSON.parse(
            await readFile(path.join(projectDir, NEW_DIR, 'manifest.json'), 'utf8'),
        ) as { features: Array<{ id: string }> }
        expect(m.features.map((f) => f.id)).toEqual(['nuxt4:nuxt4:database'])
    })
})
