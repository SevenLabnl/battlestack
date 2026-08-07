import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { exists } from '../src/utils/fs.js'
import { dotDirName, findStateDir, migrateStateDir, resolveStateDir, STATE_DIR } from '../src/utils/state-dir.js'

/**
 * These exercise the rename-adoption MECHANISM via `current`/`prior` overrides, because
 * `PRIOR_NAMES` is empty today and there is nothing to migrate FROM without one.
 */

let baseDir: string

beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-state-dir-test-'))
})

afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
})

describe('STATE_DIR', () => {
    it('is the current identity\'s dot-directory name', () => {
        expect(STATE_DIR).toBe('.battlestack')
    })
})

describe('dotDirName', () => {
    it('prefixes a name with a dot', () => {
        expect(dotDirName('battlestack')).toBe('.battlestack')
        expect(dotDirName('newname')).toBe('.newname')
    })
})

describe('migrateStateDir', () => {
    it('renames a prior-name directory to the current name, contents intact', async () => {
        const oldDir = path.join(baseDir, '.oldname')
        await mkdir(oldDir, { recursive: true })
        await writeFile(path.join(oldDir, 'manifest.json'), '{"schemaVersion":1}', 'utf8')
        await writeFile(path.join(oldDir, 'local.json'), '{"gateway":{}}', 'utf8')
        await mkdir(path.join(oldDir, 'pull'), { recursive: true })
        await writeFile(path.join(oldDir, 'pull', 'staged.txt'), 'staged', 'utf8')

        const migrated = await migrateStateDir(baseDir, { current: 'newname', prior: ['oldname'] })

        expect(migrated).toBe(true)
        expect(await exists(oldDir)).toBe(false)
        const newDir = path.join(baseDir, '.newname')
        expect(await exists(newDir)).toBe(true)
        expect(await exists(path.join(newDir, 'manifest.json'))).toBe(true)
        expect(await exists(path.join(newDir, 'local.json'))).toBe(true)
        expect(await exists(path.join(newDir, 'pull', 'staged.txt'))).toBe(true)
    })

    it('is a no-op (returns false) when the current-name dir already exists', async () => {
        const currentDir = path.join(baseDir, '.newname')
        await mkdir(currentDir, { recursive: true })
        await writeFile(path.join(currentDir, 'manifest.json'), 'current', 'utf8')
        const oldDir = path.join(baseDir, '.oldname')
        await mkdir(oldDir, { recursive: true })
        await writeFile(path.join(oldDir, 'manifest.json'), 'old', 'utf8')

        const migrated = await migrateStateDir(baseDir, { current: 'newname', prior: ['oldname'] })

        expect(migrated).toBe(false)
        // Never overwritten or merged: the already-current dir wins and the stale prior
        // one stays put. This only adopts an ORPHANED prior dir, never reconciles two.
        expect(await exists(oldDir)).toBe(true)
    })

    it('is a no-op when neither the current nor any prior-name dir exists', async () => {
        const migrated = await migrateStateDir(baseDir, { current: 'newname', prior: ['oldname'] })
        expect(migrated).toBe(false)
        expect(await readdir(baseDir)).toEqual([])
    })

    it('checks prior names in order and stops at the first match', async () => {
        const older = path.join(baseDir, '.older')
        const oldDir = path.join(baseDir, '.oldname')
        await mkdir(older, { recursive: true })
        await mkdir(oldDir, { recursive: true })

        await migrateStateDir(baseDir, { current: 'newname', prior: ['oldname', 'older'] })

        expect(await exists(path.join(baseDir, '.newname'))).toBe(true)
        // The one NOT matched first is left alone, proving this migrates one step at a
        // time rather than merging every prior name at once.
        expect(await exists(older)).toBe(true)
    })

    it('defaults to the real CURRENT_NAME/PRIOR_NAMES when no override is given', async () => {
        // PRIOR_NAMES is empty today, so this is a no-op with real constants: coverage
        // that the default path does not throw or touch anything on an empty directory.
        const migrated = await migrateStateDir(baseDir)
        expect(migrated).toBe(false)
    })
})

describe('resolveStateDir', () => {
    it('migrates a prior-name dir and returns the current-name path', async () => {
        await mkdir(path.join(baseDir, '.oldname'), { recursive: true })
        const resolved = await resolveStateDir(baseDir, { current: 'newname', prior: ['oldname'] })
        expect(resolved).toBe(path.join(baseDir, '.newname'))
        expect(await exists(resolved)).toBe(true)
    })

    it('returns the current-name path even when nothing exists yet (fresh project)', async () => {
        const resolved = await resolveStateDir(baseDir, { current: 'newname', prior: ['oldname'] })
        expect(resolved).toBe(path.join(baseDir, '.newname'))
        expect(await exists(resolved)).toBe(false)
    })
})

describe('findStateDir', () => {
    it('finds the current name first when both exist', async () => {
        await mkdir(path.join(baseDir, '.newname'), { recursive: true })
        await mkdir(path.join(baseDir, '.oldname'), { recursive: true })
        const found = await findStateDir(baseDir, ['newname', 'oldname'])
        expect(found).toBe(path.join(baseDir, '.newname'))
    })

    it('falls back to a prior name without mutating anything', async () => {
        const oldDir = path.join(baseDir, '.oldname')
        await mkdir(oldDir, { recursive: true })
        const found = await findStateDir(baseDir, ['newname', 'oldname'])
        expect(found).toBe(oldDir)
        // Read-only: the prior-name dir is untouched, no current-name dir created.
        expect(await exists(path.join(baseDir, '.newname'))).toBe(false)
    })

    it('returns null when nothing matches', async () => {
        expect(await findStateDir(baseDir, ['newname', 'oldname'])).toBeNull()
    })
})
