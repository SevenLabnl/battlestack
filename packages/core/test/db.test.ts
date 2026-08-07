import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyDbExtensions, usersTablePopulated, waitForPgReady } from '../src/utils/db.js'

let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-db-test-'))
})

afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
})

describe('applyDbExtensions', () => {
    it('is a no-op when the extensions directory does not exist', async () => {
        await expect(applyDbExtensions(projectDir)).resolves.toBeUndefined()
    })

    it('is a no-op when no .sql files exist', async () => {
        await mkdir(path.join(projectDir, 'server/database/extensions'), { recursive: true })
        await writeFile(path.join(projectDir, 'server/database/extensions/readme.md'), 'x', 'utf8')
        await expect(applyDbExtensions(projectDir)).resolves.toBeUndefined()
    })

    it('skips empty .sql files without spawning docker', async () => {
        await mkdir(path.join(projectDir, 'server/database/extensions'), { recursive: true })
        await writeFile(path.join(projectDir, 'server/database/extensions/001-empty.sql'), '  \n', 'utf8')
        // An empty file is skipped before any `docker compose exec`, so this must not
        // throw even though the tmp dir has no compose project.
        await expect(applyDbExtensions(projectDir)).resolves.toBeUndefined()
    })
})

describe('usersTablePopulated', () => {
    it('returns null when the database is unreachable', async () => {
        // No docker-compose.yml here, so `docker compose exec` fails and the caller must
        // fall back to trusting the manifest flag.
        expect(await usersTablePopulated(projectDir)).toBeNull()
    })
})

describe('waitForPgReady', () => {
    it('returns false once the deadline elapses', async () => {
        expect(await waitForPgReady(projectDir, 1)).toBe(false)
    })
})
