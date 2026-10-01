import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `pluginAdd` used to write any spec into the store unvalidated, reporting success while
 * `loader.ts` silently dropped it for failing `PLUGIN_NAME_RE`. Now rejected up front.
 */

const spawnSyncResolved = vi.fn()
const loadPlugins = vi.fn()
vi.mock('@battlestack/core', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    spawnSyncResolved: (...a: unknown[]) => spawnSyncResolved(...a),
    loadPlugins: (...a: unknown[]) => loadPlugins(...a),
}))

const { pluginAdd, pluginList, pluginRemove, pluginUpdate, resolvePluginRelease }
    = await import('../src/plugin-store.js')

let battlestackHome: string
let logs: string[]

beforeEach(async () => {
    battlestackHome = await mkdtemp(path.join(os.tmpdir(), 'battlestack-plugin-store-test-'))
    spawnSyncResolved.mockReset()
    spawnSyncResolved.mockReturnValue({ status: 0 })
    loadPlugins.mockReset()
    loadPlugins.mockResolvedValue({ skipped: [] })
    logs = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logs.push(args.join(' ')) })
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { logs.push(args.join(' ')) })
})

afterEach(async () => {
    await rm(battlestackHome, { recursive: true, force: true })
    vi.restoreAllMocks()
})

async function readStoreDeps(): Promise<Record<string, string>> {
    const file = path.join(battlestackHome, 'plugins', 'package.json')
    return JSON.parse(await readFile(file, 'utf8')).dependencies ?? {}
}

async function makeLocalPlugin(name: string): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-local-plugin-test-'))
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0' }))
    return dir
}

describe('pluginAdd: local path (dev checkout)', () => {
    it('rejects a package.json#name that does not match the plugin naming convention', async () => {
        const dir = await makeLocalPlugin('my-plugin')
        let error: Error | undefined
        try {
            await pluginAdd(battlestackHome, dir)
        } catch (e) {
            error = e as Error
        }
        expect(error).toBeInstanceOf(Error)
        // This message is the one place a plugin author finds out, so it must carry
        // enough to fix the name without reading loader.ts.
        expect(error?.message).toContain('my-plugin')
        expect(error?.message).toContain('battlestack-plugin')
        expect(error?.message).toContain('battlestack-preset')
        // Never written to the store: the point is to fail before it looks installed.
        await expect(readStoreDeps()).rejects.toThrow()
    })

    it('accepts an unscoped battlestack-plugin* name and links it', async () => {
        const dir = await makeLocalPlugin('battlestack-plugin-foo')
        await pluginAdd(battlestackHome, dir)
        const deps = await readStoreDeps()
        expect(deps['battlestack-plugin-foo']).toBe(`file:${dir}`)
        expect(logs.some((l) => l.includes('Linked battlestack-plugin-foo'))).toBe(true)
    })

    it('accepts a scoped @scope/battlestack-preset* name and links it', async () => {
        const dir = await makeLocalPlugin('@acme/battlestack-preset-bar')
        await pluginAdd(battlestackHome, dir)
        const deps = await readStoreDeps()
        expect(deps['@acme/battlestack-preset-bar']).toBe(`file:${dir}`)
    })
})

describe('pluginAdd: registry spec', () => {
    it('rejects a spec that does not match the plugin naming convention, before running npm install', async () => {
        await expect(pluginAdd(battlestackHome, 'my-plugin')).rejects.toThrow(/my-plugin/)
        expect(spawnSyncResolved).not.toHaveBeenCalled()
        await expect(readStoreDeps()).rejects.toThrow()
    })

    it('accepts a valid scoped spec and runs npm install in the store', async () => {
        await pluginAdd(battlestackHome, '@acme/battlestack-plugin')
        const deps = await readStoreDeps()
        expect(deps['@acme/battlestack-plugin']).toBe('*')
        expect(spawnSyncResolved).toHaveBeenCalledWith(
            'npm',
            ['install', '--no-audit', '--no-fund'],
            expect.objectContaining({ cwd: path.join(battlestackHome, 'plugins') }),
        )
    })
})

const DAY = 24 * 60 * 60 * 1000

function daysAgo(days: number): string {
    return new Date(Date.now() - days * DAY).toISOString()
}

function registryView(latest: string, time: Record<string, string>) {
    return { status: 0, stdout: JSON.stringify({ 'dist-tags': { latest }, time }) }
}

async function seedStore(deps: Record<string, string>, installed: Record<string, string> = {}): Promise<string> {
    const dir = path.join(battlestackHome, 'plugins')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'store', private: true, dependencies: deps }))
    for (const [name, version] of Object.entries(installed)) {
        const pkgDir = path.join(dir, 'node_modules', name)
        await mkdir(pkgDir, { recursive: true })
        await writeFile(path.join(pkgDir, 'package.json'), JSON.stringify({ name, version }))
    }
    return dir
}

function npmCalls(verb: string): string[][] {
    return spawnSyncResolved.mock.calls
        .filter(([cmd, args]) => cmd === 'npm' && (args as string[])[0] === verb)
        .map(([, args]) => args as string[])
}

describe('resolvePluginRelease', () => {
    it('targets the newest version outside the release-age window', () => {
        spawnSyncResolved.mockReturnValue(registryView('1.2.0', {
            'created': daysAgo(30), '1.0.0': daysAgo(30), '1.1.0': daysAgo(5), '1.2.0': daysAgo(1),
        }))
        expect(resolvePluginRelease(battlestackHome, 'battlestack-plugin-a', false))
            .toEqual({ latest: '1.2.0', target: '1.1.0' })
    })

    it('never targets a version above latest', () => {
        spawnSyncResolved.mockReturnValue(registryView('1.0.0', { '1.0.0': daysAgo(30), '2.0.0': daysAgo(10) }))
        expect(resolvePluginRelease(battlestackHome, 'battlestack-plugin-a', false)?.target).toBe('1.0.0')
    })

    it('targets latest under force', () => {
        spawnSyncResolved.mockReturnValue(registryView('1.2.0', { '1.2.0': daysAgo(0) }))
        expect(resolvePluginRelease(battlestackHome, 'battlestack-plugin-a', true)?.target).toBe('1.2.0')
    })

    it('returns null when the registry is unreachable', () => {
        spawnSyncResolved.mockReturnValue({ status: 1, stdout: '' })
        expect(resolvePluginRelease(battlestackHome, 'battlestack-plugin-a', false)).toBeNull()
    })
})

describe('pluginUpdate', () => {
    it('installs the gated target exactly and verifies it loads', async () => {
        await seedStore({ 'battlestack-plugin-a': '*' }, { 'battlestack-plugin-a': '1.0.0' })
        spawnSyncResolved.mockImplementation((_cmd: string, args: string[]) =>
            args[0] === 'view' ? registryView('1.1.0', { '1.1.0': daysAgo(10) }) : { status: 0 })

        expect(await pluginUpdate(battlestackHome, [])).toBe(true)
        expect(npmCalls('install')).toEqual([
            ['install', 'battlestack-plugin-a@1.1.0', '--save-exact', '--no-audit', '--no-fund'],
        ])
        expect(loadPlugins).toHaveBeenCalledWith([expect.objectContaining({ specifier: 'battlestack-plugin-a' })])
    })

    it('does nothing when the installed version is current', async () => {
        await seedStore({ 'battlestack-plugin-a': '1.1.0' }, { 'battlestack-plugin-a': '1.1.0' })
        spawnSyncResolved.mockReturnValue(registryView('1.1.0', { '1.1.0': daysAgo(10) }))
        expect(await pluginUpdate(battlestackHome, [])).toBe(true)
        expect(npmCalls('install')).toEqual([])
    })

    it('skips linked plugins without querying the registry', async () => {
        await seedStore({ 'battlestack-plugin-a': 'file:/src/a' })
        expect(await pluginUpdate(battlestackHome, [])).toBe(true)
        expect(spawnSyncResolved).not.toHaveBeenCalled()
    })

    it('rolls back and reports a version that fails to load', async () => {
        await seedStore({ 'battlestack-plugin-a': '*' }, { 'battlestack-plugin-a': '1.0.0' })
        spawnSyncResolved.mockImplementation((_cmd: string, args: string[]) =>
            args[0] === 'view' ? registryView('2.0.0', { '2.0.0': daysAgo(10) }) : { status: 0 })
        loadPlugins.mockResolvedValue({ skipped: [{ specifier: 'battlestack-plugin-a', via: 'store', error: 'apiVersion 2' }] })
        const onRejected = vi.fn()

        expect(await pluginUpdate(battlestackHome, [], { onRejected })).toBe(false)
        expect(onRejected).toHaveBeenCalledWith('battlestack-plugin-a', '2.0.0')
        expect(npmCalls('install').map((a) => a[1])).toEqual(['battlestack-plugin-a@2.0.0', 'battlestack-plugin-a@1.0.0'])
    })

    it('refuses to run while another update holds a fresh lock, and takes over a stale one', async () => {
        const dir = await seedStore({ 'battlestack-plugin-a': '1.1.0' }, { 'battlestack-plugin-a': '1.1.0' })
        spawnSyncResolved.mockReturnValue(registryView('1.1.0', { '1.1.0': daysAgo(10) }))
        const lockFile = path.join(dir, '.update.lock')
        await writeFile(lockFile, '123')

        expect(await pluginUpdate(battlestackHome, [])).toBe(false)
        expect(spawnSyncResolved).not.toHaveBeenCalled()

        const stale = new Date(Date.now() - DAY)
        await utimes(lockFile, stale, stale)
        expect(await pluginUpdate(battlestackHome, [])).toBe(true)
        await expect(readFile(lockFile)).rejects.toThrow()
    })

    it('fails for a name that is not in the store', async () => {
        await seedStore({})
        expect(await pluginUpdate(battlestackHome, ['battlestack-plugin-missing'])).toBe(false)
    })
})

describe('pluginList and pluginRemove', () => {
    it('lists the installed version rather than the declared range', async () => {
        await seedStore({ 'battlestack-plugin-a': '*', 'battlestack-plugin-b': 'file:/src/b' }, { 'battlestack-plugin-a': '1.4.2' })
        await pluginList(battlestackHome)
        expect(logs).toContain('  battlestack-plugin-a  1.4.2')
        expect(logs).toContain('  battlestack-plugin-b  linked -> /src/b')
    })

    it('uninstalls through npm', async () => {
        await seedStore({ 'battlestack-plugin-a': '*' })
        await pluginRemove(battlestackHome, 'battlestack-plugin-a')
        expect(npmCalls('uninstall')).toEqual([['uninstall', 'battlestack-plugin-a', '--no-audit', '--no-fund']])
    })
})
