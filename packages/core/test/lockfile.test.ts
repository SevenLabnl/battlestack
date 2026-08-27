import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { acquireProjectLock } from '../src/utils/lockfile.js'

let projectDir: string
const LOCK_REL = '.battlestack/lock'

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-lock-test-'))
})
afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
})

describe('acquireProjectLock', () => {
    it('writes a lock containing pid + hostname + command + timestamp', async () => {
        const release = await acquireProjectLock(projectDir, 'battlestack test')
        const raw = await readFile(path.join(projectDir, LOCK_REL), 'utf8')
        const parsed = JSON.parse(raw) as Record<string, unknown>
        expect(parsed.pid).toBe(process.pid)
        expect(parsed.command).toBe('battlestack test')
        expect(typeof parsed.hostname).toBe('string')
        expect(typeof parsed.startedAt).toBe('string')
        await release()
    })

    it('writes nothing under dryRun, not even the state dir', async () => {
        const fresh = path.join(projectDir, 'not-created-yet')
        const release = await acquireProjectLock(fresh, 'battlestack create', { dryRun: true })
        const { exists } = await import('../src/utils/fs.js')
        expect(await exists(fresh)).toBe(false)
        // Release is a no-op, safe to call in the same `finally`.
        await release()
        expect(await exists(fresh)).toBe(false)
    })

    it('does not block a concurrent dryRun, in either order', async () => {
        const release = await acquireProjectLock(projectDir, 'battlestack pull')
        const dryRelease = await acquireProjectLock(projectDir, 'battlestack pull', { dryRun: true })
        await dryRelease()
        // The real lock survives the dry-run release.
        const { exists } = await import('../src/utils/fs.js')
        expect(await exists(path.join(projectDir, LOCK_REL))).toBe(true)
        await release()
    })

    it('removes the lock on release', async () => {
        const release = await acquireProjectLock(projectDir, 'battlestack test')
        await release()
        const { exists } = await import('../src/utils/fs.js')
        expect(await exists(path.join(projectDir, LOCK_REL))).toBe(false)
    })

    it('refuses concurrent acquire from a live pid', async () => {
        const release = await acquireProjectLock(projectDir, 'battlestack a')
        await expect(acquireProjectLock(projectDir, 'battlestack b')).rejects.toThrow(
            /already running/i,
        )
        await release()
    })

    it('reclaims a stale lock pointing at a dead pid', async () => {
        await mkdir(path.join(projectDir, '.battlestack'), { recursive: true })
        const stale = {
            pid: 999_999_999,
            hostname: 'old-host',
            startedAt: new Date().toISOString(),
            command: 'battlestack zombie',
        }
        await writeFile(path.join(projectDir, LOCK_REL), JSON.stringify(stale))
        const release = await acquireProjectLock(projectDir, 'battlestack new')
        const raw = await readFile(path.join(projectDir, LOCK_REL), 'utf8')
        expect(JSON.parse(raw).pid).toBe(process.pid)
        await release()
    })

    it('reclaims a lock older than the stale threshold even if the pid is live', async () => {
        await mkdir(path.join(projectDir, '.battlestack'), { recursive: true })
        const ancient = {
            pid: process.pid,
            hostname: 'old',
            startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            command: 'battlestack ancient',
        }
        await writeFile(path.join(projectDir, LOCK_REL), JSON.stringify(ancient))
        const release = await acquireProjectLock(projectDir, 'battlestack fresh')
        const raw = await readFile(path.join(projectDir, LOCK_REL), 'utf8')
        expect(JSON.parse(raw).command).toBe('battlestack fresh')
        await release()
    })

    it('release is idempotent', async () => {
        const release = await acquireProjectLock(projectDir, 'battlestack test')
        await release()
        await expect(release()).resolves.toBeUndefined()
    })
})
