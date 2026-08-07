import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverPlugins, PLUGIN_NAME_RE } from '../src/loader.js'
import { setUiPort, type UiPort } from '../src/ui-port.js'

/**
 * `discoverPlugins` used to silently `continue` past a store entry failing
 * `PLUGIN_NAME_RE`, so `plugin add` reported success and never loaded. Now it warns.
 */

let battlestackHome: string
let warnings: string[]

function noop(): void {}

/** Installs a UiPort that only records `warn()` calls; every other method is a no-op. */
function installCapturingUiPort(): void {
    warnings = []
    const port: UiPort = {
        debug: noop,
        warn: (msg) => warnings.push(msg),
        dim: noop,
        blank: noop,
        bullet: noop,
        sym: { ok: '', warn: '', fail: '' },
        color: { dim: (s: string) => s },
        withSpinnerPaused: async (fn) => fn(),
        setActiveSpinner: noop,
    }
    setUiPort(port)
}

beforeEach(async () => {
    battlestackHome = await mkdtemp(path.join(os.tmpdir(), 'battlestack-loader-test-'))
    installCapturingUiPort()
})

afterEach(async () => {
    await rm(battlestackHome, { recursive: true, force: true })
    // Reset to a fresh silent port so this capture never leaks into another file; there
    // is no exported "restore default".
    setUiPort({
        debug: noop, warn: noop, dim: noop, blank: noop, bullet: noop,
        sym: { ok: '', warn: '', fail: '' }, color: { dim: (s: string) => s },
        withSpinnerPaused: async (fn) => fn(), setActiveSpinner: noop,
    })
})

async function writeStoreDeps(deps: Record<string, string>): Promise<void> {
    const dir = path.join(battlestackHome, 'plugins')
    await mkdir(dir, { recursive: true })
    await writeFile(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'battlestack-plugin-store', private: true, dependencies: deps }),
    )
}

describe('PLUGIN_NAME_RE', () => {
    it('accepts both unscoped and scoped battlestack-plugin*/battlestack-preset* shapes', () => {
        expect(PLUGIN_NAME_RE.test('battlestack-plugin-foo')).toBe(true)
        expect(PLUGIN_NAME_RE.test('battlestack-preset-bar')).toBe(true)
        expect(PLUGIN_NAME_RE.test('@acme/battlestack-plugin-foo')).toBe(true)
        expect(PLUGIN_NAME_RE.test('@acme/battlestack-preset')).toBe(true)
    })

    it('rejects a name with no battlestack-plugin*/battlestack-preset* prefix', () => {
        expect(PLUGIN_NAME_RE.test('my-plugin')).toBe(false)
        expect(PLUGIN_NAME_RE.test('@acme/my-plugin')).toBe(false)
        expect(PLUGIN_NAME_RE.test('battlestack-thing')).toBe(false)
    })
})

describe('discoverPlugins: store scan naming validation', () => {
    it('drops a non-matching store entry from the discovered sources', async () => {
        await writeStoreDeps({ 'my-plugin': '1.0.0' })
        const sources = await discoverPlugins({ bundled: [], bundledBasedir: battlestackHome, battlestackHome })
        expect(sources.some((s) => s.specifier === 'my-plugin')).toBe(false)
    })

    it('warns (does not silently skip) when a store entry does not match PLUGIN_NAME_RE', async () => {
        await writeStoreDeps({ 'my-plugin': '1.0.0' })
        await discoverPlugins({ bundled: [], bundledBasedir: battlestackHome, battlestackHome })
        expect(warnings.length).toBe(1)
        expect(warnings[0]).toContain('my-plugin')
        expect(warnings[0]).toContain('battlestack plugin remove my-plugin')
    })

    it('does not warn for a valid (scoped) store entry, and keeps it discovered', async () => {
        await writeStoreDeps({ '@acme/battlestack-plugin': '1.0.0' })
        const sources = await discoverPlugins({ bundled: [], bundledBasedir: battlestackHome, battlestackHome })
        expect(sources.some((s) => s.specifier === '@acme/battlestack-plugin')).toBe(true)
        expect(warnings.length).toBe(0)
    })

    it('warns once per bad entry, independently, alongside good entries', async () => {
        await writeStoreDeps({
            'battlestack-plugin-good': '1.0.0',
            'bad-one': '1.0.0',
            'bad-two': '1.0.0',
        })
        const sources = await discoverPlugins({ bundled: [], bundledBasedir: battlestackHome, battlestackHome })
        expect(sources.map((s) => s.specifier)).toEqual(['battlestack-plugin-good'])
        expect(warnings.length).toBe(2)
        expect(warnings.some((w) => w.includes('bad-one'))).toBe(true)
        expect(warnings.some((w) => w.includes('bad-two'))).toBe(true)
    })
})
