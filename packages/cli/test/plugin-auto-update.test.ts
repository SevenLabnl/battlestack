import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spawnSyncResolved = vi.fn()
vi.mock('@battlestack/core', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    spawnSyncResolved: (...a: unknown[]) => spawnSyncResolved(...a),
}))

const spawnSync = vi.fn()
vi.mock('node:child_process', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    spawnSync: (...a: unknown[]) => spawnSync(...a),
}))

const {
    applyPendingPluginUpdates,
    notifyOutdatedPlugins,
    readAutoUpdatePolicy,
    recordRejectedVersion,
    setAutoUpdatePolicy,
} = await import('../src/plugin-auto-update.js')

const PLUGIN = 'battlestack-plugin-a'

let home: string
let logs: string[]

beforeEach(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'battlestack-plugin-auto-update-test-'))
    spawnSyncResolved.mockReset()
    spawnSync.mockReset()
    logs = []
    for (const channel of ['log', 'warn', 'error'] as const) {
        vi.spyOn(console, channel).mockImplementation((...args: unknown[]) => { logs.push(args.join(' ')) })
    }
    vi.stubEnv('CI', '')
    vi.stubEnv('BATTLESTACK_NO_UPDATE_CHECK', '')
    await seedInstalled('1.0.0')
})

afterEach(async () => {
    await rm(home, { recursive: true, force: true })
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
})

async function seedInstalled(version: string): Promise<void> {
    const dir = path.join(home, 'plugins')
    await mkdir(path.join(dir, 'node_modules', PLUGIN), { recursive: true })
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'store', private: true, dependencies: { [PLUGIN]: '*' } }))
    await writeFile(path.join(dir, 'node_modules', PLUGIN, 'package.json'), JSON.stringify({ name: PLUGIN, version }))
}

async function seedCache(target: string, checkedAt = Date.now()): Promise<void> {
    await writeFile(
        path.join(home, 'plugin-update-check.json'),
        JSON.stringify({ checkedAt, releases: { [PLUGIN]: { latest: target, target } }, rejected: {} }),
    )
}

describe('auto-update policy', () => {
    it('defaults to notify', async () => {
        expect(await readAutoUpdatePolicy(home)).toBe('notify')
    })

    it('persists a valid policy and rejects an unknown one', async () => {
        await setAutoUpdatePolicy(home, 'apply')
        expect(await readAutoUpdatePolicy(home)).toBe('apply')
        await expect(setAutoUpdatePolicy(home, 'always')).rejects.toThrow(/off, notify, apply/)
    })
})

describe('notifyOutdatedPlugins', () => {
    it('reports an update from a fresh cache without querying the registry', async () => {
        await seedCache('1.1.0')
        await notifyOutdatedPlugins(home)
        expect(spawnSyncResolved).not.toHaveBeenCalled()
        expect(logs.some((l) => l.includes(`${PLUGIN} 1.0.0 → 1.1.0`))).toBe(true)
    })

    it('refreshes a stale cache from the registry', async () => {
        await seedCache('1.0.0', 0)
        const published = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
        spawnSyncResolved.mockReturnValue({
            status: 0,
            stdout: JSON.stringify({ 'dist-tags': { latest: '1.2.0' }, 'time': { '1.2.0': published } }),
        })
        await notifyOutdatedPlugins(home)
        const cache = JSON.parse(await readFile(path.join(home, 'plugin-update-check.json'), 'utf8'))
        expect(cache.releases[PLUGIN]).toEqual({ latest: '1.2.0', target: '1.2.0' })
        expect(logs.some((l) => l.includes('1.0.0 → 1.2.0'))).toBe(true)
    })

    it('stays silent for a version that was rejected', async () => {
        await seedCache('1.1.0')
        await recordRejectedVersion(home, PLUGIN, '1.1.0')
        await notifyOutdatedPlugins(home)
        expect(logs).toEqual([])
    })

    it('does nothing under off, or in CI', async () => {
        await seedCache('1.1.0', 0)
        await setAutoUpdatePolicy(home, 'off')
        logs = []
        await notifyOutdatedPlugins(home)
        await setAutoUpdatePolicy(home, 'notify')
        vi.stubEnv('CI', 'true')
        logs = []
        await notifyOutdatedPlugins(home)
        expect(logs).toEqual([])
        expect(spawnSyncResolved).not.toHaveBeenCalled()
    })
})

describe('applyPendingPluginUpdates', () => {
    it('runs `plugin update` in a child process under apply', async () => {
        await seedCache('1.1.0')
        await setAutoUpdatePolicy(home, 'apply')
        await applyPendingPluginUpdates(home)
        expect(spawnSync).toHaveBeenCalledWith(
            process.execPath,
            [process.argv[1], 'plugin', 'update', PLUGIN],
            expect.objectContaining({ env: expect.objectContaining({ BATTLESTACK_NO_UPDATE_CHECK: '1' }) }),
        )
    })

    it('does not install under notify', async () => {
        await seedCache('1.1.0')
        await applyPendingPluginUpdates(home)
        expect(spawnSync).not.toHaveBeenCalled()
    })

    it('does not retry a rejected version', async () => {
        await seedCache('1.1.0')
        await setAutoUpdatePolicy(home, 'apply')
        await recordRejectedVersion(home, PLUGIN, '1.1.0')
        await applyPendingPluginUpdates(home)
        expect(spawnSync).not.toHaveBeenCalled()
    })
})
