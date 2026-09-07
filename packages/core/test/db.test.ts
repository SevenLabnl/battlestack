import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { run } from '../src/utils/run.js'
import { applyDbExtensions, usersTablePopulated, waitForPgReady } from '../src/utils/db.js'

// Never spawn a real `docker` from tests. On a runner with no reachable daemon,
// `docker compose exec` takes tens of seconds to fail and its child holds the
// cwd open, which timed out the suite and then broke tmp-dir cleanup on Windows.
vi.mock('../src/utils/run.js', () => ({ run: vi.fn() }))

const runMock = vi.mocked(run)
const unreachable = () => Promise.reject(new Error('Cannot connect to the Docker daemon'))
const ok = (stdout: string) => Promise.resolve({ stdout, stderr: '', code: 0 })

let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-db-test-'))
    runMock.mockReset()
    runMock.mockImplementation(unreachable)
})

afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true, maxRetries: 3 })
})

async function writeExtension(name: string, sql: string): Promise<void> {
    const dir = path.join(projectDir, 'server/database/extensions')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, name), sql, 'utf8')
}

describe('applyDbExtensions', () => {
    it('is a no-op when the extensions directory does not exist', async () => {
        await expect(applyDbExtensions(projectDir)).resolves.toBeUndefined()
        expect(runMock).not.toHaveBeenCalled()
    })

    it('is a no-op when no .sql files exist', async () => {
        await writeExtension('readme.md', 'x')
        await expect(applyDbExtensions(projectDir)).resolves.toBeUndefined()
        expect(runMock).not.toHaveBeenCalled()
    })

    it('skips empty .sql files', async () => {
        await writeExtension('001-empty.sql', '  \n')
        await expect(applyDbExtensions(projectDir)).resolves.toBeUndefined()
        expect(runMock).not.toHaveBeenCalled()
    })

    it('applies each .sql file in lexical order', async () => {
        runMock.mockImplementation(() => ok(''))
        await writeExtension('002-second.sql', 'SELECT 2;')
        await writeExtension('001-first.sql', 'SELECT 1;')
        await writeExtension('010-tenth.sql', 'SELECT 10;')

        await applyDbExtensions(projectDir)

        const applied = runMock.mock.calls.map(([, args]) => args.at(-1))
        expect(applied).toEqual(['SELECT 1;', 'SELECT 2;', 'SELECT 10;'])
        expect(runMock).toHaveBeenCalledWith(
            'docker',
            expect.arrayContaining(['compose', 'exec', '-T', 'db', 'psql']),
            expect.objectContaining({ cwd: projectDir }),
        )
    })

    it('propagates a failing statement instead of continuing', async () => {
        runMock.mockImplementation(() => Promise.reject(new Error('ON_ERROR_STOP=1')))
        await writeExtension('001-bad.sql', 'SELECT bad;')
        await writeExtension('002-after.sql', 'SELECT 2;')

        await expect(applyDbExtensions(projectDir)).rejects.toThrow('ON_ERROR_STOP=1')
        expect(runMock).toHaveBeenCalledTimes(1)
    })
})

describe('usersTablePopulated', () => {
    it('returns null when the database is unreachable', async () => {
        expect(await usersTablePopulated(projectDir)).toBeNull()
    })

    it('returns true when psql reports a row', async () => {
        runMock.mockImplementation(() => ok('t\n'))
        expect(await usersTablePopulated(projectDir)).toBe(true)
    })

    it('returns false when psql reports no rows', async () => {
        runMock.mockImplementation(() => ok('f\n'))
        expect(await usersTablePopulated(projectDir)).toBe(false)
    })

    it('returns null on output it cannot read', async () => {
        runMock.mockImplementation(() => ok('ERROR: relation "users" does not exist'))
        expect(await usersTablePopulated(projectDir)).toBeNull()
    })
})

describe('waitForPgReady', () => {
    it('returns false once the deadline elapses', async () => {
        expect(await waitForPgReady(projectDir, 1)).toBe(false)
    })

    it('requires two consecutive successful probes', async () => {
        let call = 0
        runMock.mockImplementation(() => {
            call++
            return call === 2 ? unreachable() : ok('1')
        })

        expect(await waitForPgReady(projectDir, 10_000)).toBe(true)
        expect(call).toBe(4)
    })
})
