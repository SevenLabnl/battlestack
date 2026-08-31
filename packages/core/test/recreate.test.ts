import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `detectStale` probes docker for leftover containers. Spawning it for real made
// these tests wait on the daemon: on a Windows runner with none reachable,
// `docker ps` sits on the named pipe long enough to blow the suite timeout, and
// the test that lost the race was whichever ran last. The daemon-absent answer
// is what these cases want anyway, so report it directly.
let nextSpawn: { error: Error } | { lines: string[] } | { hang: true } = {
    error: new Error('docker not found'),
}
let killed = false

vi.mock('node:child_process', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    spawn: () => {
        const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter, kill: () => void }
        child.stdout = new EventEmitter()
        child.kill = () => {
            killed = true
        }
        queueMicrotask(() => {
            // A daemon that is installed but not running answers neither way.
            if ('hang' in nextSpawn) return
            if ('error' in nextSpawn) {
                child.emit('error', nextSpawn.error)
                return
            }
            for (const line of nextSpawn.lines) child.stdout.emit('data', Buffer.from(line + '\n'))
            child.emit('close', 0)
        })
        return child
    },
}))

const { describeStale, detectStale, detectComposeProject } = await import('../src/utils/recreate.js')

let tmpDir: string

beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-recreate-test-'))
    nextSpawn = { error: new Error('docker not found') }
    killed = false
})

afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 3 })
})

describe('detectStale', () => {
    it('fast-paths to all-false when the directory does not exist', async () => {
        const result = await detectStale('nope', path.join(tmpDir, 'missing'))
        expect(result).toEqual({ dir: false, docker: false, incomplete: false })
    })

    it('flags a non-empty directory', async () => {
        const dir = path.join(tmpDir, 'proj')
        await mkdir(dir)
        await writeFile(path.join(dir, 'leftover.txt'), 'x', 'utf8')
        const result = await detectStale('battlestack-test-no-such-compose-project', dir)
        expect(result.dir).toBe(true)
        expect(result.incomplete).toBe(false)
    })

    it('treats an empty existing directory as not stale', async () => {
        const dir = path.join(tmpDir, 'empty')
        await mkdir(dir)
        const result = await detectStale('battlestack-test-no-such-compose-project', dir)
        expect(result.dir).toBe(false)
    })

    it('detects an incomplete manifest from a crashed run', async () => {
        const dir = path.join(tmpDir, 'crashed')
        await mkdir(path.join(dir, '.battlestack'), { recursive: true })
        await writeFile(
            path.join(dir, '.battlestack', 'manifest.json'),
            JSON.stringify({ incomplete: true }),
            'utf8',
        )
        const result = await detectStale('battlestack-test-no-such-compose-project', dir)
        expect(result.incomplete).toBe(true)
    })

    it('tolerates a malformed manifest', async () => {
        const dir = path.join(tmpDir, 'broken')
        await mkdir(path.join(dir, '.battlestack'), { recursive: true })
        await writeFile(path.join(dir, '.battlestack', 'manifest.json'), '{not json', 'utf8')
        const result = await detectStale('battlestack-test-no-such-compose-project', dir)
        expect(result.incomplete).toBe(false)
    })

    it('flags leftover compose containers', async () => {
        const dir = path.join(tmpDir, 'withdocker')
        await mkdir(dir)
        nextSpawn = { lines: ['a1b2c3d4e5f6'] }
        const result = await detectStale('demo', dir)
        expect(result.docker).toBe(true)
    })
})

describe('detectComposeProject', () => {
    it('is false when docker is not installed', async () => {
        expect(await detectComposeProject('demo')).toBe(false)
    })

    it('is false when no container carries the label', async () => {
        nextSpawn = { lines: [] }
        expect(await detectComposeProject('demo')).toBe(false)
    })

    it('is true when a container id comes back', async () => {
        nextSpawn = { lines: ['a1b2c3d4e5f6'] }
        expect(await detectComposeProject('demo')).toBe(true)
    })

    // docker on Windows terminates lines with CRLF, and the id is fed straight
    // into a `docker rm` on the teardown path.
    it('trims a CRLF id', async () => {
        nextSpawn = { lines: ['a1b2c3d4e5f6\r'] }
        expect(await detectComposeProject('demo')).toBe(true)
    })

    // The reason for the bound: an installed-but-stopped daemon leaves the probe
    // waiting on the socket, which used to hang the caller indefinitely.
    it('gives up on a daemon that never answers, and kills the child', async () => {
        nextSpawn = { hang: true }
        vi.useFakeTimers()
        try {
            const pending = detectComposeProject('demo')
            await vi.advanceTimersByTimeAsync(5000)
            expect(await pending).toBe(false)
            expect(killed).toBe(true)
        } finally {
            vi.useRealTimers()
        }
    })
})

describe('describeStale', () => {
    it('joins all stale parts', () => {
        const out = describeStale('demo', '/tmp/demo', { dir: true, docker: true, incomplete: true })
        expect(out).toContain('INCOMPLETE manifest')
        expect(out).toContain('dir /tmp/demo/')
        expect(out).toContain('docker compose project "demo"')
        expect(out.split(' + ')).toHaveLength(3)
    })

    it('mentions only what is actually stale', () => {
        expect(describeStale('demo', '/tmp/demo', { dir: true, docker: false })).toBe('dir /tmp/demo/')
        expect(describeStale('demo', '/tmp/demo', { dir: false, docker: true }))
            .toBe('docker compose project "demo"')
        expect(describeStale('demo', '/tmp/demo', { dir: false, docker: false })).toBe('')
    })
})
