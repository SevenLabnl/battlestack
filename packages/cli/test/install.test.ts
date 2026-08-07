import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    BattlestackRegistries,
    installArgs,
    type EnvDiff,
    type Provenance,
    type RunContext,
} from '@battlestack/core'
import { bootstrapProject, installCommand, pgWaitTiming } from '../src/commands/install.js'
import { defaultArgs, withCwd, withCwdCapture } from './test-utils.js'

/**
 * `ensureEnv`/`ensureDeps`/`ensureDb` are private, so they are covered through the exported
 * `bootstrapProject`. Mocked at the boundary: `run`, `spawnSyncResolved`, and `applyEnv`.
 */

const calls: string[] = []
async function defaultRunImpl(_cmd: string, args: string[]): Promise<{ stdout: string, stderr: string, code: number }> {
    if (args[0] === 'install') calls.push('deps')
    else if (args[0] === 'compose' && args[1] === 'up') calls.push('docker-up')
    else if (args[0] === 'run' && args[1] === 'db:migrate') calls.push('db:migrate')
    else if (args[0] === 'run' && args[1] === 'db:push') calls.push('db:push')
    return { stdout: '', stderr: '', code: 0 }
}
const run = vi.fn(defaultRunImpl)
const spawnSyncResolved = vi.fn()
const applyEnvMock = vi.fn(async (): Promise<EnvDiff> => ({ newKeys: [], valueChanged: [] }))

vi.mock('@battlestack/core', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    run: (...a: Parameters<typeof run>) => run(...a),
    spawnSyncResolved: (...a: unknown[]) => spawnSyncResolved(...a),
}))
vi.mock('@battlestack/preset-nuxt4', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    applyEnv: (...a: Parameters<typeof applyEnvMock>) => applyEnvMock(...a),
}))

function dockerOk(): { status: number } {
    return { status: 0 }
}
function dockerFail(): { status: number } {
    return { status: 1 }
}

let projectDir: string

beforeEach(() => {
    calls.length = 0
    // `mockReset`, not `mockClear`: a test overriding `run`'s implementation to reject
    // must not leak that into the next one.
    run.mockReset()
    run.mockImplementation(defaultRunImpl)
    spawnSyncResolved.mockReset()
    applyEnvMock.mockClear()
    applyEnvMock.mockResolvedValue({ newKeys: [], valueChanged: [] })
})

afterEach(async () => {
    vi.restoreAllMocks()
    if (projectDir) await rm(projectDir, { recursive: true, force: true })
})

function ctx(overrides: Partial<RunContext> = {}): RunContext {
    return {
        projectName: path.basename(projectDir),
        projectDir,
        framework: { id: 'fw', label: 'fw', supportedFeatures: [] },
        template: { id: 'tpl', label: 'tpl', framework: 'fw', requiredFeatures: [], optionalFeatures: [] },
        enabledFeatures: new Set(),
        state: {},
        debug: false,
        dryRun: false,
        registries: new BattlestackRegistries(),
        ...overrides,
    }
}

describe('bootstrapProject: ordering', () => {
    beforeEach(async () => {
        projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-install-test-'))
    })

    it('runs env -> deps -> db in order when nuxt4:database is enabled', async () => {
        spawnSyncResolved.mockReturnValue(dockerOk()) // hasDocker() + pg_isready both succeed first try
        await bootstrapProject(ctx({ enabledFeatures: new Set(['nuxt4:database']) }), 'pnpm')
        expect(applyEnvMock).toHaveBeenCalledTimes(1)
        expect(calls).toEqual(['deps', 'docker-up', 'db:push'])
    })

    it('includeDb: false skips the db step even though nuxt4:database is enabled', async () => {
        await bootstrapProject(
            ctx({ enabledFeatures: new Set(['nuxt4:database']) }),
            'pnpm',
            { includeDb: false },
        )
        expect(applyEnvMock).toHaveBeenCalledTimes(1)
        expect(calls).toEqual(['deps'])
        expect(spawnSyncResolved).not.toHaveBeenCalled()
    })

    it('skips the db step when nuxt4:database is not enabled, regardless of includeDb', async () => {
        await bootstrapProject(ctx({ enabledFeatures: new Set() }), 'pnpm')
        expect(calls).toEqual(['deps'])
    })

    it('runs db:migrate instead of db:push when SQL migrations are present', async () => {
        await mkdir(path.join(projectDir, 'server', 'database', 'migrations'), { recursive: true })
        await writeFile(path.join(projectDir, 'server', 'database', 'migrations', '0001_init.sql'), '-- x\n')
        spawnSyncResolved.mockReturnValue(dockerOk())
        await bootstrapProject(ctx({ enabledFeatures: new Set(['nuxt4:database']) }), 'pnpm')
        expect(calls).toEqual(['deps', 'docker-up', 'db:migrate'])
    })
})

describe('ensureEnv (via bootstrapProject)', () => {
    beforeEach(async () => {
        projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-install-test-'))
    })

    it('calls applyEnv with writeExample:false whether or not .env already exists', async () => {
        await bootstrapProject(ctx(), 'pnpm')
        expect(applyEnvMock).toHaveBeenCalledWith(expect.anything(), { writeExample: false })

        applyEnvMock.mockClear()
        await writeFile(path.join(projectDir, '.env'), 'EXISTING=1\n', 'utf8')
        await bootstrapProject(ctx(), 'pnpm')
        expect(applyEnvMock).toHaveBeenCalledWith(expect.anything(), { writeExample: false })
    })

    it('never touches .env.example', async () => {
        await writeFile(path.join(projectDir, '.env.example'), 'ORIGINAL=1\n', 'utf8')
        await bootstrapProject(ctx(), 'pnpm')
        const example = await import('node:fs/promises').then((fs) =>
            fs.readFile(path.join(projectDir, '.env.example'), 'utf8'),
        )
        expect(example).toBe('ORIGINAL=1\n')
    })

    it('prints "written" for a fresh .env, "reconciled" when one already exists with new keys', async () => {
        const freshLines = await withCwdCapture(projectDir, () => bootstrapProject(ctx(), 'pnpm'))
        expect(freshLines.join('\n')).toContain('.env written')

        await writeFile(path.join(projectDir, '.env'), 'EXISTING=1\n', 'utf8')
        applyEnvMock.mockResolvedValueOnce({ newKeys: ['NEW_KEY'], valueChanged: [] })
        const reconcileLines = await withCwdCapture(projectDir, () => bootstrapProject(ctx(), 'pnpm'))
        const text = reconcileLines.join('\n')
        expect(text).toContain('reconciled')
        expect(text).toContain('NEW_KEY')
    })

    it('dry-run never calls applyEnv', async () => {
        await bootstrapProject(ctx({ dryRun: true }), 'pnpm')
        expect(applyEnvMock).not.toHaveBeenCalled()
    })
})

describe('ensureDeps (via bootstrapProject)', () => {
    beforeEach(async () => {
        projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-install-test-'))
    })

    it('skips the install when node_modules/ already exists', async () => {
        await mkdir(path.join(projectDir, 'node_modules'), { recursive: true })
        await bootstrapProject(ctx(), 'pnpm')
        expect(run).not.toHaveBeenCalled()
    })

    it('dry-run skips the install without calling run', async () => {
        await bootstrapProject(ctx({ dryRun: true }), 'pnpm')
        expect(run).not.toHaveBeenCalled()
    })

    it('installs deps with the resolved package manager\'s install args', async () => {
        await bootstrapProject(ctx(), 'bun')
        expect(run).toHaveBeenCalledWith('bun', installArgs('bun'), { cwd: projectDir, inherit: true })
    })
})

describe('ensureDb (via bootstrapProject, nuxt4:database enabled)', () => {
    beforeEach(async () => {
        projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-install-test-'))
    })

    function dbCtx(overrides: Partial<RunContext> = {}): RunContext {
        return ctx({ enabledFeatures: new Set(['nuxt4:database']), ...overrides })
    }

    it('dry-run performs no docker/spawn calls at all', async () => {
        await bootstrapProject(dbCtx({ dryRun: true }), 'pnpm')
        expect(run).not.toHaveBeenCalled()
        expect(spawnSyncResolved).not.toHaveBeenCalled()
    })

    it('fails cleanly when Docker is not on PATH', async () => {
        spawnSyncResolved.mockReturnValue(dockerFail())
        const lines = await withCwdCapture(projectDir, () => bootstrapProject(dbCtx(), 'pnpm'))
        expect(lines.join('\n')).toContain('Docker not on PATH')
        // ensureDeps legitimately calls `run` once for the pm install, so assert no
        // *docker* call happened rather than "run was never called at all".
        expect(run.mock.calls.some(([cmd]) => cmd === 'docker')).toBe(false)
    })

    it('fails cleanly when docker compose up rejects', async () => {
        spawnSyncResolved.mockReturnValue(dockerOk())
        run.mockImplementation(async (cmd: string, args: string[]) => {
            if (cmd === 'docker' && args[0] === 'compose' && args[1] === 'up') {
                throw new Error('daemon down')
            }
            return { stdout: '', stderr: '', code: 0 }
        })
        const lines = await withCwdCapture(projectDir, () => bootstrapProject(dbCtx(), 'pnpm'))
        expect(lines.join('\n')).toContain('docker compose failed')
    })

    // REAL timers, budget shrunk through `pgWaitTiming`. Do not "improve" this to fake
    // timers: every variant hangs, and a hang cascades later tests into ENOENT or EBUSY.
    it('gives up when postgres never becomes ready, without proceeding to migrate', async () => {
        const original = { ...pgWaitTiming }
        Object.assign(pgWaitTiming, { budgetMs: 60, pollMs: 5 })
        try {
            // First call is `hasDocker()`, which must succeed to reach the wait loop.
            // Every call after is `pg_isready`, always failing, so the budget runs out.
            spawnSyncResolved.mockImplementationOnce(() => dockerOk())
            spawnSyncResolved.mockImplementation(() => dockerFail())

            const lines = await withCwdCapture(projectDir, () =>
                bootstrapProject(dbCtx(), 'pnpm'),
            )
            expect(lines.join('\n')).toMatch(/postgres did not become ready within \d+s/)
            // Giving up must NOT go on to touch the schema of a database it never
            // reached; without this the test passes on the message while `db:push` runs.
            expect(calls).toEqual(['deps', 'docker-up'])
        } finally {
            Object.assign(pgWaitTiming, original)
        }
    })

    // Pins the shipped budget, because the test above shrinks it: without this, changing
    // the production wait to 3s or 300s leaves every assertion above green.
    it('waits 30s by default', () => {
        expect(pgWaitTiming).toEqual({ budgetMs: 30_000, pollMs: 500 })
    })
})

const origin: Provenance = { plugin: '@test/install', namespace: 'installtest' }

describe('installCommand: end to end', () => {
    let registries: BattlestackRegistries

    beforeEach(async () => {
        projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-install-cmd-test-'))
        registries = new BattlestackRegistries()
        registries.frameworks.register({ id: 'install-fw', label: 'fw', supportedFeatures: [] }, origin)
        registries.templates.register(
            { id: 'install-tpl', label: 'tpl', framework: 'install-fw', requiredFeatures: [], optionalFeatures: [] },
            origin,
        )
        await mkdir(path.join(projectDir, '.battlestack'), { recursive: true })
        await writeFile(
            path.join(projectDir, '.battlestack', 'manifest.json'),
            JSON.stringify({
                schemaVersion: 1,
                cliVersion: '0.0.0',
                framework: 'install-fw',
                template: 'install-tpl',
                packageManager: 'pnpm',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
                features: [],
            }),
            'utf8',
        )
    })

    it('throws outside a project', async () => {
        const outside = await mkdtemp(path.join(os.tmpdir(), 'battlestack-install-outside-'))
        try {
            await expect(
                withCwd(outside, () => installCommand(defaultArgs(), undefined as never, registries)),
            ).rejects.toThrow(/Not inside a battlestack project/)
        } finally {
            await rm(outside, { recursive: true, force: true })
        }
    })

    it('bootstraps and prints "Install complete"', async () => {
        const lines = await withCwdCapture(projectDir, () =>
            installCommand(defaultArgs(), undefined as never, registries),
        )
        expect(lines.join('\n')).toContain('Install complete')
        expect(applyEnvMock).toHaveBeenCalledTimes(1)
    })
})
