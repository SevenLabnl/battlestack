import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MANIFEST_PATH, readManifest, renameProject, stampProjectName, writeManifest } from '../src/manifest.js'
import { isLinkedWorktree, resolveProjectName } from '../src/project-name.js'
import { BattlestackRegistries } from '../src/registry.js'
import { buildRunContext } from '../src/run-context.js'
import type { ProjectManifest } from '../src/types/project-manifest.js'

const origin = { plugin: 'test-plugin', namespace: 'demo' }

let root: string
let mainDir: string
let worktreeDir: string
let registries: BattlestackRegistries

function git(cwd: string, ...args: string[]): void {
    execFileSync('git', args, {
        cwd,
        stdio: 'ignore',
        env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
    })
}

const manifest: ProjectManifest = {
    schemaVersion: 1,
    cliVersion: '1.0.0',
    framework: 'manifest-test',
    template: 'manifest-test',
    packageManager: 'pnpm',
    projectName: 'my-app',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    features: [],
}

async function readRaw(dir: string): Promise<ProjectManifest> {
    return JSON.parse(await readFile(path.join(dir, MANIFEST_PATH), 'utf8')) as ProjectManifest
}

beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'battlestack-project-name-'))
    mainDir = path.join(root, 'my-app')
    worktreeDir = path.join(root, 'my-app-feature')
    await mkdir(path.join(mainDir, path.dirname(MANIFEST_PATH)), { recursive: true })
    await writeFile(path.join(mainDir, MANIFEST_PATH), JSON.stringify(manifest))
    git(mainDir, 'init', '-q')
    git(mainDir, 'add', '-A')
    git(mainDir, 'commit', '-q', '-m', 'init')
    git(mainDir, 'worktree', 'add', '-q', worktreeDir)

    registries = new BattlestackRegistries()
    registries.frameworks.register({ id: 'manifest-test', label: 'manifest-test', supportedFeatures: [] }, origin)
    registries.templates.register({
        id: 'manifest-test', label: 'manifest-test', framework: 'manifest-test', requiredFeatures: [], optionalFeatures: [],
    }, origin)
})

afterEach(async () => {
    await rm(root, { recursive: true, force: true })
})

describe('isLinkedWorktree', () => {
    it('is true in a linked worktree and its subdirectories', async () => {
        expect(isLinkedWorktree(worktreeDir)).toBe(true)
        expect(isLinkedWorktree(path.join(worktreeDir, path.dirname(MANIFEST_PATH)))).toBe(true)
    })

    it('is false in the main checkout and outside any repo', () => {
        expect(isLinkedWorktree(mainDir)).toBe(false)
        expect(isLinkedWorktree(root)).toBe(false)
    })

    it('is false in a submodule, which also has a .git file', async () => {
        const fakeModuleGitDir = path.join(root, 'modules', 'sub')
        const subDir = path.join(root, 'sub')
        await mkdir(fakeModuleGitDir, { recursive: true })
        await mkdir(subDir)
        await writeFile(path.join(subDir, '.git'), `gitdir: ${fakeModuleGitDir}\n`)
        expect(isLinkedWorktree(subDir)).toBe(false)
    })
})

describe('project name in a linked worktree', () => {
    it('resolves to the recorded name, not the worktree directory', async () => {
        const m = (await readManifest(worktreeDir, registries)) as ProjectManifest
        expect(resolveProjectName(worktreeDir, m)).toBe('my-app')
        expect(buildRunContext({ projectDir: worktreeDir, manifest: m }, registries).projectName).toBe('my-app')
    })

    it('falls back to the directory name when the manifest has no recorded name', () => {
        expect(resolveProjectName(worktreeDir, { projectName: undefined })).toBe('my-app-feature')
    })

    it('stampProjectName leaves the manifest alone', async () => {
        const m = (await readManifest(worktreeDir, registries)) as ProjectManifest
        await stampProjectName(worktreeDir, m)
        const after = await readRaw(worktreeDir)
        expect(after.projectName).toBe('my-app')
        expect(after.previousNames).toBeUndefined()
    })

    it('writeManifest keeps the recorded name', async () => {
        const m = (await readManifest(worktreeDir, registries)) as ProjectManifest
        const ctx = buildRunContext({ projectDir: worktreeDir, manifest: m }, registries)
        await writeManifest(ctx, { cliVersion: '2.0.0' })
        const after = await readRaw(worktreeDir)
        expect(after.cliVersion).toBe('2.0.0')
        expect(after.projectName).toBe('my-app')
    })
})

describe('project name outside a worktree', () => {
    async function cloneInto(dirName: string): Promise<string> {
        const clone = path.join(root, dirName)
        execFileSync('git', ['clone', '-q', mainDir, clone], { stdio: 'ignore' })
        return clone
    }

    it('keeps the recorded name in a clone under another directory name', async () => {
        const clone = await cloneInto('demo')
        const m = (await readManifest(clone, registries)) as ProjectManifest
        expect(resolveProjectName(clone, m)).toBe('my-app')
        await stampProjectName(clone, m)
        const ctx = buildRunContext({ projectDir: clone, manifest: m }, registries)
        expect(ctx.projectName).toBe('my-app')
        await writeManifest(ctx, { cliVersion: '2.0.0' })
        const after = await readRaw(clone)
        expect(after.projectName).toBe('my-app')
        expect(after.previousNames).toBeUndefined()
    })

    it('keeps the recorded name after the directory is renamed', async () => {
        const renamed = path.join(root, 'my-renamed-app')
        await rename(mainDir, renamed)
        const m = (await readManifest(renamed, registries)) as ProjectManifest
        expect(resolveProjectName(renamed, m)).toBe('my-app')
        await stampProjectName(renamed, m)
        expect((await readRaw(renamed)).projectName).toBe('my-app')
    })
})

describe('renameProject', () => {
    it('renames and keeps the old name in previousNames', async () => {
        const m = (await readManifest(mainDir, registries)) as ProjectManifest
        expect(await renameProject(mainDir, m, 'shop')).toBe('my-app')
        const after = await readRaw(mainDir)
        expect(after.projectName).toBe('shop')
        expect(after.previousNames).toEqual(['my-app'])
    })

    it('renaming back drops the name from previousNames', async () => {
        const m = (await readManifest(mainDir, registries)) as ProjectManifest
        await renameProject(mainDir, m, 'shop')
        expect(await renameProject(mainDir, m, 'my-app')).toBe('shop')
        const after = await readRaw(mainDir)
        expect(after.projectName).toBe('my-app')
        expect(after.previousNames).toEqual(['shop'])
    })

    it('is a no-op for the current name', async () => {
        const m = (await readManifest(mainDir, registries)) as ProjectManifest
        expect(await renameProject(mainDir, m, 'my-app')).toBeNull()
        expect((await readRaw(mainDir)).previousNames).toBeUndefined()
    })
})
