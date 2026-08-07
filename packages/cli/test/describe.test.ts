import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BattlestackRegistries, allocatePort } from '@battlestack/core'
import { defaultArgs, withCwd, withCwdCapture } from './test-utils.js'

/**
 * Two process boundaries: `docker ps` (raw `spawn`, not routed through `run()`, so mocked
 * directly) and port/`.env` reads, left real because they are pure and deterministic.
 */

interface FakeChild extends EventEmitter {
    stdout: EventEmitter
}

let nextSpawnResult: { lines: string[] } | { error: Error } = { lines: [] }

vi.mock('node:child_process', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    spawn: () => {
        const child = new EventEmitter() as FakeChild
        child.stdout = new EventEmitter()
        queueMicrotask(() => {
            if ('error' in nextSpawnResult) {
                child.emit('error', nextSpawnResult.error)
                return
            }
            for (const line of nextSpawnResult.lines) child.stdout.emit('data', Buffer.from(line + '\n'))
            child.emit('close', 0)
        })
        return child
    },
}))

const { describeCommand } = await import('../src/commands/describe.js')

let projectDir: string
const registries = new BattlestackRegistries()

async function writeManifestFile(features: string[]): Promise<void> {
    await mkdir(path.join(projectDir, '.battlestack'), { recursive: true })
    await writeFile(
        path.join(projectDir, '.battlestack', 'manifest.json'),
        JSON.stringify({
            schemaVersion: 1,
            cliVersion: '0.0.0',
            framework: 'nuxt4',
            template: 'nuxt4-minimal',
            packageManager: 'pnpm',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            // Bare (not fqid) ids: `enabledHas`'s direct-membership fast path matches
            // these without the ids being registered.
            features: features.map((id) => ({ id, version: '1.0.0', files: {} })),
        }),
        'utf8',
    )
}

async function run(): Promise<string[]> {
    return withCwdCapture(projectDir, () => describeCommand(defaultArgs(), undefined as never, registries))
}

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-describe-test-'))
    nextSpawnResult = { lines: [] }
})

afterEach(async () => {
    vi.restoreAllMocks()
    await rm(projectDir, { recursive: true, force: true })
})

describe('describeCommand', () => {
    it('throws outside a project', async () => {
        // `beforeEach` gives a fresh, empty tmpdir with no manifest written yet.
        await expect(
            withCwd(projectDir, () => describeCommand(defaultArgs(), undefined as never, registries)),
        ).rejects.toThrow(/Not inside a battlestack project/)
    })

    it('reports .env present vs missing', async () => {
        await writeManifestFile([])
        const withoutEnv = await run()
        expect(withoutEnv.join('\n')).toContain('.env missing')

        await writeFile(path.join(projectDir, '.env'), 'X=1\n', 'utf8')
        const withEnv = await run()
        expect(withEnv.join('\n')).toContain('.env present')
    })

    describe('service gating by enabled features', () => {
        it('shows only "app" when nothing else is enabled', async () => {
            await writeManifestFile([])
            const lines = await run()
            const text = lines.join('\n')
            expect(text).toContain('app')
            expect(text).not.toContain('db (postgres)')
            expect(text).not.toContain('smtp (mailpit)')
            expect(text).not.toContain('mail-ui (mailpit)')
            expect(text).not.toContain('s3 (rustfs)')
            expect(text).not.toContain('s3-console')
            expect(text).not.toContain('mastra-studio')
            expect(text).not.toContain('redis (rate-limit accelerator)')
        })

        it('shows db only when nuxt4:database is enabled', async () => {
            await writeManifestFile(['nuxt4:database'])
            const text = (await run()).join('\n')
            expect(text).toContain('db (postgres)')
            expect(text).not.toContain('smtp (mailpit)')
        })

        it('shows smtp + mail-ui only when nuxt4:auth is enabled', async () => {
            await writeManifestFile(['nuxt4:auth'])
            const text = (await run()).join('\n')
            expect(text).toContain('smtp (mailpit)')
            expect(text).toContain('mail-ui (mailpit)')
            expect(text).not.toContain('db (postgres)')
        })

        it('shows s3 + s3-console only when nuxt4:storage is enabled', async () => {
            await writeManifestFile(['nuxt4:storage'])
            const text = (await run()).join('\n')
            expect(text).toContain('s3 (rustfs)')
            expect(text).toContain('s3-console')
        })

        it('shows mastra-studio only when nuxt4:mastra is enabled', async () => {
            await writeManifestFile(['nuxt4:mastra'])
            const text = (await run()).join('\n')
            expect(text).toContain('mastra-studio')
        })

        it('shows redis only when nuxt4:redis is enabled; it never implies the accelerator is on', async () => {
            await writeManifestFile(['nuxt4:database', 'nuxt4:auth'])
            const withoutRedis = (await run()).join('\n')
            expect(withoutRedis).not.toContain('redis (rate-limit accelerator)')

            await writeManifestFile(['nuxt4:database', 'nuxt4:auth', 'nuxt4:redis'])
            const withRedis = (await run()).join('\n')
            expect(withRedis).toContain('redis (rate-limit accelerator)')
        })

        it('shows every service when every feature is enabled', async () => {
            await writeManifestFile(['nuxt4:database', 'nuxt4:auth', 'nuxt4:storage', 'nuxt4:mastra', 'nuxt4:redis'])
            const text = (await run()).join('\n')
            for (const label of ['db (postgres)', 'smtp (mailpit)', 'mail-ui (mailpit)', 's3 (rustfs)', 's3-console', 'mastra-studio', 'redis (rate-limit accelerator)']) {
                expect(text).toContain(label)
            }
        })
    })

    describe('port resolution', () => {
        it('falls back to the deterministic per-project hash when .env has no override', async () => {
            await writeManifestFile([])
            const projectName = path.basename(projectDir)
            const expectedPort = allocatePort(projectName, 'app')
            const text = (await run()).join('\n')
            expect(text).toContain(`localhost:${expectedPort}`)
        })

        it('prefers the .env-frozen port over the hash once scaffold has written one', async () => {
            await writeManifestFile([])
            await writeFile(path.join(projectDir, '.env'), 'NUXT_PORT=54321\n', 'utf8')
            const text = (await run()).join('\n')
            expect(text).toContain('localhost:54321')
        })
    })

    describe('gateway row', () => {
        it('is absent without local.json gateway state', async () => {
            await writeManifestFile([])
            expect((await run()).join('\n')).not.toContain('gateway')
        })

        it('shows the https URL when gateway is enabled in local.json', async () => {
            await writeManifestFile([])
            await mkdir(path.join(projectDir, '.battlestack'), { recursive: true })
            await writeFile(
                path.join(projectDir, '.battlestack', 'local.json'),
                JSON.stringify({ gateway: { enabled: true, hostname: 'demo.battlestack.test' } }),
                'utf8',
            )
            const text = (await run()).join('\n')
            expect(text).toContain('https://demo.battlestack.test')
        })
    })

    describe('containers', () => {
        it('reports "No containers running" when docker ps returns nothing', async () => {
            await writeManifestFile([])
            nextSpawnResult = { lines: [] }
            expect((await run()).join('\n')).toContain('No containers running')
        })

        it('lists containers from docker ps JSON lines, malformed lines skipped', async () => {
            await writeManifestFile([])
            nextSpawnResult = {
                lines: [
                    JSON.stringify({ Names: 'demo-app-1', Image: 'demo:latest', Status: 'Up 2 minutes', State: 'running', Ports: '' }),
                    'not-json-garbage',
                    JSON.stringify({ Names: 'demo-db-1', Image: 'postgres:16', Status: 'Exited (0) 1 minute ago', State: 'exited', Ports: '' }),
                ],
            }
            const text = (await run()).join('\n')
            expect(text).toContain('demo-app-1')
            expect(text).toContain('Up 2 minutes')
            expect(text).toContain('demo-db-1')
            expect(text).toContain('Exited (0) 1 minute ago')
        })

        it('resolves to no containers if `docker` itself is missing (spawn errors)', async () => {
            await writeManifestFile([])
            nextSpawnResult = { error: new Error('ENOENT') }
            expect((await run()).join('\n')).toContain('No containers running')
        })
    })
})
