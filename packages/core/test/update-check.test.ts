import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { notifyIfOutdated } from '../src/utils/update-check.js'

// Pin the cache location to a temp HOME so tests never touch ~/.battlestack.
const tmpHome = await vi.hoisted(async () => {
    const { mkdtemp } = await import('node:fs/promises')
    const os = await import('node:os')
    const path = await import('node:path')
    return mkdtemp(path.join(os.tmpdir(), 'battlestack-update-check-home-'))
})

vi.mock('node:os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:os')>()
    // `node:os`'s CJS module type has no `.default` member, and the synthetic default
    // vitest exposes at runtime is not reflected in `typeof import(...)`, so cast.
    const actualDefault = (actual as unknown as { default?: typeof actual }).default ?? actual
    return {
        ...actual,
        default: { ...actualDefault, homedir: () => tmpHome },
        homedir: () => tmpHome,
    }
})

const cacheFile = path.join(tmpHome, '.battlestack', 'update-check.json')

let logged: string[]

beforeEach(async () => {
    logged = []
    // The default `UiPort` routes `warn()` through `console.warn` and the rest through
    // `console.log`, so capture both and stay channel-agnostic.
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        logged.push(args.join(' '))
    })
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        logged.push(args.join(' '))
    })
    vi.stubEnv('CI', '')
    vi.stubEnv('BATTLESTACK_NO_UPDATE_CHECK', '')
    await rm(path.join(tmpHome, '.battlestack'), { recursive: true, force: true })
})

afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
})

async function writeCache(latest: string | null, ageMs = 0): Promise<void> {
    await mkdir(path.dirname(cacheFile), { recursive: true })
    await writeFile(cacheFile, JSON.stringify({ checkedAt: Date.now() - ageMs, latest }), 'utf8')
}

describe('notifyIfOutdated', () => {
    it('warns when the cached latest is newer', async () => {
        await writeCache('99.0.0')
        await notifyIfOutdated('2.3.1')
        expect(logged.join('\n')).toContain('2.3.1 → 99.0.0')
        expect(logged.join('\n')).toContain('self-update')
    })

    it('stays silent when up to date', async () => {
        await writeCache('2.3.1')
        await notifyIfOutdated('2.3.1')
        expect(logged.join('\n')).not.toContain('self-update')
    })

    it('stays silent when the cache holds an older version', async () => {
        await writeCache('2.3.0')
        await notifyIfOutdated('2.3.1')
        expect(logged.join('\n')).not.toContain('self-update')
    })

    it('compares semver numerically, not lexically', async () => {
        await writeCache('2.10.0')
        await notifyIfOutdated('2.9.9')
        expect(logged.join('\n')).toContain('2.9.9 → 2.10.0')
    })

    it('is skipped entirely in CI', async () => {
        vi.stubEnv('CI', 'true')
        await writeCache('99.0.0')
        await notifyIfOutdated('2.3.1')
        expect(logged.join('\n')).not.toContain('self-update')
    })

    it('is skipped when BATTLESTACK_NO_UPDATE_CHECK is set', async () => {
        vi.stubEnv('BATTLESTACK_NO_UPDATE_CHECK', '1')
        await writeCache('99.0.0')
        await notifyIfOutdated('2.3.1')
        expect(logged.join('\n')).not.toContain('self-update')
    })

    it('treats a null cached latest as "no update"', async () => {
        await writeCache(null)
        await notifyIfOutdated('2.3.1')
        expect(logged.join('\n')).not.toContain('self-update')
    })
})
