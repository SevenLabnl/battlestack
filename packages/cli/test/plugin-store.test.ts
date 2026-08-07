import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `pluginAdd` used to write any spec into the store unvalidated, reporting success while
 * `loader.ts` silently dropped it for failing `PLUGIN_NAME_RE`. Now rejected up front.
 */

const spawnSyncResolved = vi.fn()
vi.mock('@battlestack/core', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    spawnSyncResolved: (...a: unknown[]) => spawnSyncResolved(...a),
}))

const { pluginAdd } = await import('../src/plugin-store.js')

let battlestackHome: string
let logs: string[]

beforeEach(async () => {
    battlestackHome = await mkdtemp(path.join(os.tmpdir(), 'battlestack-plugin-store-test-'))
    spawnSyncResolved.mockReset()
    spawnSyncResolved.mockReturnValue({ status: 0 })
    logs = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logs.push(args.join(' ')) })
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
