import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    BattlestackRegistries,
    hashFile,
    type Feature,
    type ParsedArgs,
    type Provenance,
} from '@battlestack/core'
import { defaultArgs, withCwdCapture } from './test-utils.js'
import { doctorCommand } from '../src/commands/doctor.js'

/**
 * `doctorCommand` is the only export, so assertions go through it and read printed lines.
 * `spawnSyncResolved` is mocked so results never depend on what the machine has installed.
 */

const spawnSyncResolved = vi.fn()
vi.mock('@battlestack/core', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    spawnSyncResolved: (...args: unknown[]) => spawnSyncResolved(...args),
}))

// `pmChecks` spawns through core's own `win-exec` import, bypassing the barrel above.
vi.mock('@battlestack/core/utils/win-exec.js', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    spawnSyncResolved: (...args: unknown[]) => spawnSyncResolved(...args),
}))

function ok(): { status: number } {
    return { status: 0 }
}
function failing(): { status: number } {
    return { status: 1 }
}

/** `spawnSyncResolved(cmd, args, opts)` → dispatch on `cmd` per test. */
function mockCommands(available: Record<string, boolean>): void {
    spawnSyncResolved.mockImplementation((cmd: string) => (available[cmd] ? ok() : failing()))
}

let tmpDir: string

beforeEach(() => {
    spawnSyncResolved.mockReset()
})

afterEach(async () => {
    vi.restoreAllMocks()
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true })
})

describe('doctorCommand: outside a project (cliDoctor)', () => {
    beforeEach(async () => {
        // A fresh tmpdir has no manifest above it, so `findProjectRoot` returns null.
        tmpDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-doctor-outside-'))
    })

    async function run(): Promise<string[]> {
        return withCwdCapture(tmpDir, () =>
            doctorCommand(defaultArgs(), undefined as never, new BattlestackRegistries()),
        )
    }

    it('is "ok" when pnpm specifically is on PATH, with no hint', async () => {
        mockCommands({ pnpm: true, bun: false, npm: false, git: true, docker: true })
        const lines = await run()
        const line = lines.find((l) => l.includes('package manager on PATH'))!
        expect(line).toContain('found: pnpm')
        expect(line).not.toContain('pnpm is the default')
    })

    it('is "ok" (not "fail") when only npm is on PATH: npm is first-class, not a fallback', async () => {
        mockCommands({ pnpm: false, bun: false, npm: true, git: true, docker: true })
        const lines = await run()
        const line = lines.find((l) => l.includes('package manager on PATH'))!
        expect(line).toContain('found: npm')
        // Still hints, since pnpm is absent, but must not be a hard failure.
        expect(line).toContain('pnpm is the default')
        expect(line).not.toMatch(/✗.*package manager on PATH|package manager on PATH.*✗/)
    })

    it('is "fail" only when NONE of pnpm/bun/npm are present', async () => {
        mockCommands({ pnpm: false, bun: false, npm: false, git: true, docker: true })
        const lines = await run()
        const line = lines.find((l) => l.includes('package manager on PATH'))!
        expect(line).toContain('none of pnpm/bun/npm found on PATH')
    })

    it('warns (not fails) when git or docker is missing: both are optional here', async () => {
        mockCommands({ pnpm: true, bun: false, npm: false, git: false, docker: false })
        const lines = await run()
        expect(lines.find((l) => l.includes('git on PATH'))).toContain('not found on PATH')
        expect(lines.find((l) => l.includes('docker on PATH'))).toContain('optional')
        // Neither should abort the command or print a hard failure summary for them.
        expect(lines.join('\n')).not.toContain('preflight check(s) failed')
    })
})

const origin: Provenance = { plugin: '@test/doctor', namespace: 'doctortest' }

async function writeProjectManifest(
    dir: string,
    opts: {
        packageManager?: string
        features?: Array<{ id: string, version: string, files?: Record<string, string> }>
        framework?: string
        template?: string
        optedOut?: string[]
    } = {},
): Promise<void> {
    await mkdir(path.join(dir, '.battlestack'), { recursive: true })
    await writeFile(
        path.join(dir, '.battlestack', 'manifest.json'),
        JSON.stringify({
            schemaVersion: 1,
            cliVersion: '0.0.0',
            framework: opts.framework ?? 'doctor-test-fw',
            template: opts.template ?? 'doctor-test-tpl',
            packageManager: opts.packageManager ?? 'pnpm',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            features: opts.features ?? [],
            ...(opts.optedOut ? { optedOut: opts.optedOut } : {}),
        }),
        'utf8',
    )
}

describe('doctorCommand: inside a project', () => {
    let registries: BattlestackRegistries

    beforeEach(async () => {
        tmpDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-doctor-inside-'))
        registries = new BattlestackRegistries()
        registries.frameworks.register(
            { id: 'doctor-test-fw', label: 'fw', supportedFeatures: [] },
            origin,
        )
        registries.templates.register(
            {
                id: 'doctor-test-tpl',
                label: 'tpl',
                framework: 'doctor-test-fw',
                requiredFeatures: [],
                optionalFeatures: [],
            },
            origin,
        )
    })

    async function run(args: Partial<ParsedArgs> = {}): Promise<string[]> {
        return withCwdCapture(tmpDir, () =>
            doctorCommand(defaultArgs(args), undefined as never, registries),
        )
    }

    it('hard-fails the manifest\'s own package manager when it is missing: unlike the out-of-project any-pm check', async () => {
        await writeProjectManifest(tmpDir, { packageManager: 'pnpm' })
        // pnpm missing, npm present. The out-of-project check calls this "ok" (any pm);
        // in-project must still fail, because the project is pinned to pnpm.
        mockCommands({ pnpm: false, npm: true, bun: false })
        const lines = await run()
        const line = lines.find((l) => l.includes('pnpm on PATH'))!
        expect(line).toContain('not found: install it or change packageManager in manifest')
    })

    it('is "ok" when the manifest\'s own package manager (npm) is present, regardless of pnpm', async () => {
        await writeProjectManifest(tmpDir, { packageManager: 'npm' })
        mockCommands({ pnpm: false, npm: true, bun: false })
        const lines = await run()
        const line = lines.find((l) => l.includes('npm on PATH'))!
        expect(line).not.toContain('not found')
    })

    it('reports up-to-date / stale / install-only / orphaned per feature', async () => {
        registries.features.register(
            { id: 'feat:uptodate', label: 'x', version: '1.0.0', stage: 'FINALIZE', async execute() {} } as Feature,
            origin,
        )
        registries.features.register(
            { id: 'feat:stale', label: 'x', version: '2.0.0', stage: 'FINALIZE', async execute() {} } as Feature,
            origin,
        )
        registries.features.register(
            {
                id: 'feat:installonly',
                label: 'x',
                version: '1.0.0',
                stage: 'FINALIZE',
                upgradable: false,
                async execute() {},
            } as Feature,
            origin,
        )
        // 'feat:orphaned' intentionally never registered.
        await writeProjectManifest(tmpDir, {
            packageManager: 'pnpm',
            features: [
                { id: 'doctortest:feat:uptodate', version: '1.0.0', files: {} },
                { id: 'doctortest:feat:stale', version: '1.0.0', files: {} },
                { id: 'doctortest:feat:installonly', version: '1.0.0', files: {} },
                { id: 'doctortest:feat:orphaned', version: '1.0.0', files: {} },
            ],
        })
        mockCommands({ pnpm: true })

        const lines = await run()
        const text = lines.join('\n')
        const lineFor = (id: string): string => lines.find((l) => l.includes(id))!

        expect(lineFor('feat:uptodate')).toMatch(/\bok\b/)
        expect(lineFor('feat:stale')).toContain('stale')
        expect(lineFor('feat:installonly')).toContain('install-only')
        expect(lineFor('feat:orphaned')).toContain('orphaned')
        expect(text).toContain('feature(s) stale')
        expect(text).toContain('feature(s) recorded in manifest but no longer in the CLI')
    })

    it('classifies tracked files as pristine / drifted / missing', async () => {
        const pristineContent = 'pristine contents\n'
        const drift = path.join(tmpDir, 'drifted.ts')
        const pristine = path.join(tmpDir, 'pristine.ts')
        await writeFile(drift, 'edited after install\n', 'utf8')
        await writeFile(pristine, pristineContent, 'utf8')
        // 'missing.ts' deliberately never written.

        registries.features.register(
            { id: 'feat:files', label: 'x', version: '1.0.0', stage: 'FINALIZE', async execute() {} } as Feature,
            origin,
        )
        await writeProjectManifest(tmpDir, {
            packageManager: 'pnpm',
            features: [
                {
                    id: 'doctortest:feat:files',
                    version: '1.0.0',
                    files: {
                        'drifted.ts': 'not-the-real-hash',
                        'pristine.ts': await hashFile(pristine),
                        'missing.ts': 'also-not-real',
                    },
                },
            ],
        })
        mockCommands({ pnpm: true })

        const lines = await run({ debug: true })
        const text = lines.join('\n')
        expect(text).toContain('file(s) edited since install')
        expect(text).toContain('tracked file(s) missing')
        // debug mode lists every file including pristine ones.
        expect(text).toContain('drifted.ts')
        expect(text).toContain('pristine.ts')
        expect(text).toContain('missing.ts')
    })

    it('checks Docker only when nuxt4:database is enabled, and hard-fails a missing daemon', async () => {
        registries.features.register(
            { id: 'nuxt4:database', label: 'db', version: '1.0.0', stage: 'DATABASE', async execute() {} } as Feature,
            origin,
        )
        await writeProjectManifest(tmpDir, {
            packageManager: 'pnpm',
            features: [{ id: 'doctortest:nuxt4:database', version: '1.0.0', files: {} }],
        })
        mockCommands({ pnpm: true, docker: true })
        spawnSyncResolved.mockImplementation((cmd: string, args: string[]) => {
            if (cmd === 'pnpm') return ok()
            if (cmd === 'docker' && args[0] === '--version') return ok()
            if (cmd === 'docker' && args[0] === 'info') return failing()
            return failing()
        })

        const lines = await run()
        const text = lines.join('\n')
        expect(text).toContain('Docker daemon')
        expect(text).toContain('docker info failed')
    })

    it('skips the Docker check entirely when nuxt4:database is not enabled', async () => {
        await writeProjectManifest(tmpDir, { packageManager: 'pnpm', features: [] })
        mockCommands({ pnpm: true })
        const lines = await run()
        expect(lines.join('\n')).not.toContain('Docker')
    })

    it('flags .env as missing, then reconciles once all required keys are present', async () => {
        registries.features.register(
            {
                id: 'feat:envreq',
                label: 'x',
                version: '1.0.0',
                stage: 'FINALIZE',
                async execute() {},
                collectEnv: () => [{ key: 'SOME_TOKEN', example: 'x', group: 'g', description: 'd' }],
            } as Feature,
            origin,
        )
        await writeProjectManifest(tmpDir, {
            packageManager: 'pnpm',
            features: [{ id: 'doctortest:feat:envreq', version: '1.0.0', files: {} }],
        })
        mockCommands({ pnpm: true })

        const withoutEnv = await run()
        expect(withoutEnv.join('\n')).toContain('run `battlestack install`')

        await writeFile(path.join(tmpDir, '.env'), 'SOME_TOKEN=abc\n', 'utf8')
        const withEnv = await run()
        const line = withEnv.find((l) => l.includes('.env has all required keys'))!
        expect(line).not.toContain('missing')

        await writeFile(path.join(tmpDir, '.env'), '# nothing here\n', 'utf8')
        const withPartialEnv = await run()
        const partialLine = withPartialEnv.find((l) => l.includes('.env has all required keys'))!
        expect(partialLine).toContain('missing: SOME_TOKEN')
    })
})

describe('doctorCommand: .dockerignore check', () => {
    let registries: BattlestackRegistries

    beforeEach(async () => {
        tmpDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-doctor-dockerignore-'))
        registries = new BattlestackRegistries()
        registries.frameworks.register(
            { id: 'doctor-test-fw', label: 'fw', supportedFeatures: [] },
            origin,
        )
        registries.templates.register(
            {
                id: 'doctor-test-tpl',
                label: 'tpl',
                framework: 'doctor-test-fw',
                requiredFeatures: [],
                optionalFeatures: [],
            },
            origin,
        )
        registries.features.register(
            { id: 'shared:docker', label: 'docker', version: '1.0.0', stage: 'FINALIZE', async execute() {} } as Feature,
            origin,
        )
        registries.features.register(
            { id: 'shared:other', label: 'other', version: '1.0.0', stage: 'FINALIZE', async execute() {} } as Feature,
            origin,
        )
        mockCommands({ pnpm: true, npm: true, bun: true })
    })

    async function run(): Promise<string[]> {
        return withCwdCapture(tmpDir, () =>
            doctorCommand(defaultArgs(), undefined as never, registries),
        )
    }

    it('warns when the docker feature is installed and .dockerignore is absent', async () => {
        await writeProjectManifest(tmpDir, {
            features: [{ id: 'doctortest:shared:docker', version: '1.0.0', files: {} }],
        })
        const line = (await run()).find((l) => l.includes('.dockerignore present'))!
        expect(line).toBeDefined()
        expect(line).toContain('!')
        expect(line).not.toContain('\u2713')
        expect(line).toContain('node_modules')
    })

    it('is ok when .dockerignore exists', async () => {
        await writeProjectManifest(tmpDir, {
            features: [{ id: 'doctortest:shared:docker', version: '1.0.0', files: {} }],
        })
        await writeFile(path.join(tmpDir, '.dockerignore'), 'node_modules\n', 'utf8')
        const line = (await run()).find((l) => l.includes('.dockerignore present'))!
        expect(line).toContain('\u2713')
        expect(line).not.toContain('!')
        expect(line).not.toContain('node_modules')
    })

    it('says nothing at all when the project has no docker feature', async () => {
        await writeProjectManifest(tmpDir, {
            features: [{ id: 'doctortest:shared:other', version: '1.0.0', files: {} }],
        })
        expect((await run()).find((l) => l.includes('.dockerignore'))).toBeUndefined()
    })
})

describe('doctorCommand: orphaned plugin state', () => {
    let registries: BattlestackRegistries

    beforeEach(async () => {
        tmpDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-doctor-orphan-'))
        registries = new BattlestackRegistries()
        registries.frameworks.register(
            { id: 'doctor-test-fw', label: 'fw', supportedFeatures: [] },
            origin,
        )
        registries.templates.register(
            {
                id: 'doctor-test-tpl',
                label: 'tpl',
                framework: 'doctor-test-fw',
                requiredFeatures: [],
                optionalFeatures: [],
            },
            origin,
        )
        registries.features.register(
            { id: 'shared:known', label: 'known', version: '1.0.0', stage: 'FINALIZE', async execute() {} } as Feature,
            origin,
        )
        mockCommands({ pnpm: true, npm: true, bun: true })
    })

    async function run(): Promise<string[]> {
        return withCwdCapture(tmpDir, () =>
            doctorCommand(defaultArgs(), undefined as never, registries),
        )
    }

    it('warns when a feature is recorded under a namespace no loaded plugin provides', async () => {
        await writeProjectManifest(tmpDir, {
            features: [
                { id: 'doctortest:shared:known', version: '1.0.0', files: {} },
                { id: 'someplugin:shared:deploy', version: '1.0.0', files: {} },
            ],
        })
        const line = (await run()).find((l) => l.includes('plugin state'))!
        expect(line).toBeDefined()
        expect(line).toContain('someplugin')
        expect(line).toContain('!')
    })

    it('warns on an orphaned namespace reachable only through optedOut', async () => {
        await writeProjectManifest(tmpDir, {
            features: [{ id: 'doctortest:shared:known', version: '1.0.0', files: {} }],
            optedOut: ['someplugin:shared:deploy'],
        })
        const line = (await run()).find((l) => l.includes('plugin state'))!
        expect(line).toContain('someplugin')
    })

    it('says nothing when every recorded namespace is provided by a loaded plugin', async () => {
        await writeProjectManifest(tmpDir, {
            features: [{ id: 'doctortest:shared:known', version: '1.0.0', files: {} }],
        })
        expect((await run()).find((l) => l.includes('plugin state'))).toBeUndefined()
    })

    it('ignores a bare (two-segment) id: its first segment is a domain, not a namespace', async () => {
        await writeProjectManifest(tmpDir, {
            features: [{ id: 'doctortest:shared:known', version: '1.0.0', files: {} }],
            optedOut: ['shared:docker'],
        })
        expect((await run()).find((l) => l.includes('plugin state'))).toBeUndefined()
    })

    it('says nothing for a feature the loaded plugin no longer registers: that is per-feature orphaned, not a missing plugin', async () => {
        await writeProjectManifest(tmpDir, {
            features: [
                { id: 'doctortest:shared:known', version: '1.0.0', files: {} },
                { id: 'doctortest:shared:dropped', version: '1.0.0', files: {} },
            ],
        })
        expect((await run()).find((l) => l.includes('plugin state'))).toBeUndefined()
    })
})
