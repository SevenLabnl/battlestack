import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findProjectRoot } from '../src/project-root.js'

let tmpDir: string

beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-project-root-test-'))
})

afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
})

async function makeProject(dir: string): Promise<void> {
    await mkdir(path.join(dir, '.battlestack'), { recursive: true })
    await writeFile(path.join(dir, '.battlestack', 'manifest.json'), '{}', 'utf8')
}

describe('findProjectRoot', () => {
    it('finds the manifest in the start directory itself', async () => {
        await makeProject(tmpDir)
        expect(await findProjectRoot(tmpDir)).toBe(tmpDir)
    })

    it('walks up from a nested subdirectory', async () => {
        await makeProject(tmpDir)
        const nested = path.join(tmpDir, 'server', 'api', 'deep')
        await mkdir(nested, { recursive: true })
        expect(await findProjectRoot(nested)).toBe(tmpDir)
    })

    it('returns the NEAREST project when projects nest', async () => {
        await makeProject(tmpDir)
        const inner = path.join(tmpDir, 'packages', 'inner')
        await makeProject(inner)
        expect(await findProjectRoot(path.join(inner, 'src'))).toBe(inner)
        // (path.join(inner, 'src') doesn't exist on disk; the walk is purely lexical.)
    })

    it('returns null when no manifest exists anywhere up the tree', async () => {
        expect(await findProjectRoot(tmpDir)).toBeNull()
    })

    // The mechanism findProjectRoot exists to protect: a project scaffolded under a name
    // that ISN'T today's first must still be recognized, not silently invisible.
    it('recognizes a project under a prior name when told to look for it', async () => {
        await mkdir(path.join(tmpDir, '.oldname'), { recursive: true })
        await writeFile(path.join(tmpDir, '.oldname', 'manifest.json'), '{}', 'utf8')
        expect(await findProjectRoot(tmpDir, ['newname', 'oldname'])).toBe(tmpDir)
    })

    it('prefers the current name over a prior one when both exist', async () => {
        await makeProject(tmpDir)
        await mkdir(path.join(tmpDir, '.oldname'), { recursive: true })
        await writeFile(path.join(tmpDir, '.oldname', 'manifest.json'), '{}', 'utf8')
        // Both resolve to the same root here, but this proves the walk does not error or
        // short-circuit with two candidate dirs present at once.
        expect(await findProjectRoot(tmpDir, ['battlestack', 'oldname'])).toBe(tmpDir)
    })

    it('does NOT recognize a prior-name project when that name is not in the list', async () => {
        await mkdir(path.join(tmpDir, '.oldname'), { recursive: true })
        await writeFile(path.join(tmpDir, '.oldname', 'manifest.json'), '{}', 'utf8')
        expect(await findProjectRoot(tmpDir, ['newname'])).toBeNull()
    })
})
