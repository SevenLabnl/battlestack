import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MANIFEST_PATH, type ProjectManifest } from '@battlestack/core'
import { renameCommand } from '../src/commands/rename.js'
import { defaultArgs, withCwd } from './test-utils.js'

let projectDir: string

async function readRaw(): Promise<ProjectManifest> {
    return JSON.parse(await readFile(path.join(projectDir, MANIFEST_PATH), 'utf8')) as ProjectManifest
}

function rename(name: string | undefined, dryRun = false): Promise<void> {
    return withCwd(projectDir, () =>
        renameCommand(defaultArgs({ positionals: ['rename', ...(name ? [name] : [])], secondPositional: name, dryRun }), undefined as never))
}

beforeEach(async () => {
    projectDir = path.join(await mkdtemp(path.join(os.tmpdir(), 'battlestack-rename-')), 'demo')
    await mkdir(path.join(projectDir, path.dirname(MANIFEST_PATH)), { recursive: true })
    await writeFile(path.join(projectDir, MANIFEST_PATH), JSON.stringify({
        schemaVersion: 1,
        cliVersion: '1.0.0',
        framework: 'fw',
        template: 'tpl',
        packageManager: 'pnpm',
        projectName: 'demo',
        previousNames: ['my-app'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        features: [],
    }))
})

afterEach(async () => {
    await rm(path.dirname(projectDir), { recursive: true, force: true })
})

describe('battlestack rename', () => {
    it('restores a name the directory-rename bug replaced', async () => {
        await rename('my-app')
        const after = await readRaw()
        expect(after.projectName).toBe('my-app')
        expect(after.previousNames).toEqual(['demo'])
    })

    it('rejects an invalid name and writes nothing', async () => {
        await expect(rename('My App')).rejects.toThrow(/invalid/i)
        expect((await readRaw()).projectName).toBe('demo')
    })

    it('requires a name', async () => {
        await expect(rename(undefined)).rejects.toThrow(/usage/i)
    })

    it('writes nothing under --dry-run', async () => {
        await rename('my-app', true)
        expect((await readRaw()).projectName).toBe('demo')
    })
})
