import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { run } from '../src/utils/run.js'
import { ensureHostsEntry, hostsPath, platform, removeHostsEntry } from '../src/utils/hosts-file.js'

// Never touch the real /etc/hosts or invoke sudo from tests.
vi.mock('../src/utils/run.js', () => ({
    run: vi.fn(async () => ({ stdout: '', stderr: '', code: 0 })),
}))

// Pin the platform to darwin so the elevation path is deterministic on any host; linux
// throws "not supported" by design, which would fail these in CI.
vi.mock('node:os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:os')>()
    // `node:os`'s CJS module type has no `.default` member, and the synthetic default
    // vitest exposes at runtime is not reflected in `typeof import(...)`, so cast.
    const actualDefault = (actual as unknown as { default?: typeof actual }).default ?? actual
    return {
        ...actual,
        default: { ...actualDefault, platform: () => 'darwin' as NodeJS.Platform },
        platform: () => 'darwin' as NodeJS.Platform,
    }
})

const files = new Map<string, string>()
vi.mock('node:fs/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs/promises')>()
    return {
        ...actual,
        readFile: vi.fn(async (p: string) => {
            if (files.has(String(p))) return files.get(String(p))!
            throw new Error('ENOENT')
        }),
        writeFile: vi.fn(async (p: string, contents: string) => {
            files.set(String(p), contents)
        }),
    }
})

const runMock = vi.mocked(run)
const MARKER = '# managed by battlestack'

/** The contents writeWithElevation staged into its tmp file (last write wins). */
function stagedContents(): string {
    const tmpEntry = [...files.entries()].findLast(([p]) => p.includes('battlestack-hosts-'))
    return tmpEntry?.[1] ?? ''
}

beforeEach(() => {
    files.clear()
    runMock.mockClear()
})

afterEach(() => {
    vi.clearAllMocks()
})

describe('platform + hostsPath', () => {
    it('reports the (mocked) platform and a matching hosts path', () => {
        expect(platform()).toBe('darwin')
        expect(hostsPath()).toBe('/etc/hosts')
    })
})

describe('ensureHostsEntry', () => {
    it('appends a tab-separated managed line when missing', async () => {
        files.set(hostsPath(), '127.0.0.1\tlocalhost\n')
        const changed = await ensureHostsEntry({ ip: '127.0.0.1', hostname: 'demo.battlestack.test' })
        expect(changed).toBe(true)
        const written = stagedContents()
        expect(written).toContain('127.0.0.1\tlocalhost\n')
        expect(written).toContain(`127.0.0.1\tdemo.battlestack.test\t${MARKER}\n`)
        // macOS path escalates via sudo cp.
        expect(runMock).toHaveBeenCalled()
    })

    it('is a no-op when the entry already exists (even unmanaged)', async () => {
        files.set(hostsPath(), '127.0.0.1 demo.battlestack.test\n')
        const changed = await ensureHostsEntry({ ip: '127.0.0.1', hostname: 'demo.battlestack.test' })
        expect(changed).toBe(false)
        expect(runMock).not.toHaveBeenCalled()
    })

    it('adds a newline separator when the file lacks a trailing one', async () => {
        files.set(hostsPath(), '127.0.0.1\tlocalhost')
        await ensureHostsEntry({ ip: '127.0.0.1', hostname: 'demo.battlestack.test' })
        expect(stagedContents()).toContain('localhost\n127.0.0.1\tdemo.battlestack.test')
    })

    it('treats a missing hosts file as empty', async () => {
        const changed = await ensureHostsEntry({ ip: '127.0.0.1', hostname: 'demo.battlestack.test' })
        expect(changed).toBe(true)
        expect(stagedContents()).toContain('demo.battlestack.test')
    })
})

describe('removeHostsEntry', () => {
    it('strips only the managed line', async () => {
        files.set(
            hostsPath(),
            `127.0.0.1\tlocalhost\n127.0.0.1\tdemo.battlestack.test\t${MARKER}\n127.0.0.1\tkeep.me\n`,
        )
        const changed = await removeHostsEntry({ ip: '127.0.0.1', hostname: 'demo.battlestack.test' })
        expect(changed).toBe(true)
        const written = stagedContents()
        expect(written).not.toContain('demo.battlestack.test')
        expect(written).toContain('localhost')
        expect(written).toContain('keep.me')
    })

    it('is a no-op when the entry is absent', async () => {
        files.set(hostsPath(), '127.0.0.1\tlocalhost\n')
        const changed = await removeHostsEntry({ ip: '127.0.0.1', hostname: 'demo.battlestack.test' })
        expect(changed).toBe(false)
        expect(runMock).not.toHaveBeenCalled()
    })

    // MARKER goes into the user's REAL hosts file. If a rename changes the marker text,
    // a line an OLDER-named CLI wrote can never be matched again and lingers forever.
    it('removes an entry marked by a PRIOR name when told to look for it', async () => {
        files.set(
            hostsPath(),
            '127.0.0.1\tlocalhost\n127.0.0.1\tdemo.oldname.test\t# managed by oldname\n127.0.0.1\tkeep.me\n',
        )
        const changed = await removeHostsEntry({ ip: '127.0.0.1', hostname: 'demo.oldname.test' }, ['oldname'])
        expect(changed).toBe(true)
        const written = stagedContents()
        expect(written).not.toContain('demo.oldname.test')
        expect(written).toContain('keep.me')
    })

    it('leaves a foreign-marked entry\'s content untouched when that name is not in the list', async () => {
        const content = '127.0.0.1\tlocalhost\n127.0.0.1\tdemo.oldname.test\t# managed by oldname\n'
        files.set(hostsPath(), content)
        await removeHostsEntry({ ip: '127.0.0.1', hostname: 'demo.oldname.test' }, ['battlestack'])
        // hasEntry() is marker-agnostic so a write is still staged, but stripEntry's
        // marker regex will not match an unrecognized marker.
        expect(stagedContents()).toBe(content)
    })
})
