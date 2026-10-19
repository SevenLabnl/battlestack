import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BattlestackRegistries, updateLedger, type ProjectManifest, type RunContext } from '@battlestack/core'
import {
    needsAttention,
    preflight,
    recordedAtStart,
    renderReport,
    repairOverwrites,
    type PullSummary,
} from '../src/commands/pull-safety.js'

let projectDir: string
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

function git(...args: string[]): void {
    execFileSync('git', args, {
        cwd: projectDir,
        stdio: 'ignore',
        env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
    })
}

async function write(rel: string, content: string): Promise<void> {
    await mkdir(path.dirname(path.join(projectDir, rel)), { recursive: true })
    await writeFile(path.join(projectDir, rel), content)
}

const read = (rel: string): Promise<string> => readFile(path.join(projectDir, rel), 'utf8')

function manifestWith(files: Record<string, string>): ProjectManifest {
    return {
        schemaVersion: 1,
        cliVersion: '1.0.0',
        framework: 'fw',
        template: 'tpl',
        packageManager: 'pnpm',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        features: [{ id: 'test:feat', version: '1.0.0', files }],
    }
}

function ctxRecording(files: Record<string, string>, dir = projectDir, state: Record<string, unknown> = {}): RunContext {
    return {
        projectName: 'demo',
        projectDir: dir,
        framework: undefined as never,
        template: undefined as never,
        enabledFeatures: new Set(),
        state: { 'files:test:feat': files, ...state },
        debug: false,
        dryRun: false,
        registries: new BattlestackRegistries(),
    }
}

async function commitAll(): Promise<void> {
    git('add', '-A')
    git('commit', '-q', '-m', 'commit')
}

const EMPTY: PullSummary = {
    merged: [], conflicts: [], staged: [], backups: [], unmanaged: [], restored: [], added: [], orphans: [], actions: [], repairs: [],
}

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-pull-safety-'))
})

afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
})

describe('preflight', () => {
    it('refuses a working tree with uncommitted changes, unless allowed', async () => {
        git('init', '-q')
        await write('a.txt', 'a\n')
        git('add', '-A')
        git('commit', '-q', '-m', 'init')
        await write('a.txt', 'changed\n')
        const manifest = manifestWith({})
        await expect(preflight(projectDir, manifest, { allowDirty: false })).rejects.toThrow(/uncommitted changes/)
        await expect(preflight(projectDir, manifest, { allowDirty: true })).resolves.toEqual({ git: true, clean: false })
    })

    it('refuses to start while a merged file still has conflict markers', async () => {
        await write('a.ts', '<<<<<<< a.ts (yours)\nx\n=======\ny\n>>>>>>> a.ts (upstream now)\n')
        await expect(preflight(projectDir, manifestWith({ 'a.ts': sha256('y\n') }), { allowDirty: true }))
            .rejects.toThrow(/conflict markers/)
    })

    it('runs outside git, reporting that it could not check', async () => {
        await expect(preflight(projectDir, manifestWith({}), { allowDirty: false })).resolves.toEqual({ git: false, clean: false })
    })

    it('lets --force and --overwrite start over conflict markers, since they replace the file', async () => {
        await write('a.ts', '<<<<<<< a.ts (yours)\nx\n=======\ny\n>>>>>>> a.ts (upstream now)\n')
        await expect(preflight(projectDir, manifestWith({ 'a.ts': sha256('y\n') }), { allowDirty: true, replacing: true }))
            .resolves.toEqual({ git: false, clean: false })
    })

    it('in a monorepo, looks only at the project directory', async () => {
        git('init', '-q')
        await write('apps/web/a.txt', 'a\n')
        await write('README.md', 'root\n')
        await commitAll()
        await write('README.md', 'edited elsewhere in the repository\n')
        await expect(preflight(path.join(projectDir, 'apps/web'), manifestWith({}), { allowDirty: false }))
            .resolves.toEqual({ git: true, clean: true })
    })
})

/** Files put back from HEAD are in their checked-out form, which is CRLF on a Windows runner with core.autocrlf. */
const lf = (text: string): string => text.replaceAll('\r\n', '\n')

describe('repairOverwrites', () => {
    it('puts back local edits a feature wrote over, and stages its version', async () => {
        git('init', '-q')
        await write('Dockerfile', 'FROM node\nCOPY patches/ ./patches/\n')
        git('add', '-A')
        git('commit', '-q', '-m', 'init')
        const start = recordedAtStart(manifestWith({ Dockerfile: sha256('FROM node\n') }))

        // A feature that writes without the drift check.
        await write('Dockerfile', 'FROM node:24\n')
        const ctx = ctxRecording({ Dockerfile: sha256('FROM node:24\n') })

        const repairs = await repairOverwrites(ctx, start, ctx.registries)
        expect(repairs).toEqual([{ rel: 'Dockerfile', featureId: 'test:feat', outcome: 'staged' }])
        expect(lf(await read('Dockerfile'))).toBe('FROM node\nCOPY patches/ ./patches/\n')
        expect(await read('.battlestack/pull/Dockerfile.new')).toBe('FROM node:24\n')
        expect(await read('.battlestack/pull/Dockerfile.patch')).toContain('+FROM node:24')
        expect(updateLedger(ctx).staged).toContain('Dockerfile')
        // Unmerged, so the next pull must still see the old upstream as the base.
        expect((ctx.state['files:test:feat'] as Record<string, string>).Dockerfile).toBe(sha256('FROM node\n'))
    })

    it('leaves a file alone that was pristine before the pull', async () => {
        git('init', '-q')
        await write('a.ts', 'v1\n')
        git('add', '-A')
        git('commit', '-q', '-m', 'init')
        const start = recordedAtStart(manifestWith({ 'a.ts': sha256('v1\n') }))
        await write('a.ts', 'v2\n')
        const ctx = ctxRecording({ 'a.ts': sha256('v2\n') })

        expect(await repairOverwrites(ctx, start, ctx.registries)).toEqual([])
        expect(await read('a.ts')).toBe('v2\n')
    })

    it('compares against HEAD as checked out, so an eol-converted pristine file is not taken for an edit', async () => {
        git('init', '-q')
        await write('.gitattributes', '*.txt text eol=crlf\n')
        await write('a.txt', 'v1\r\n')
        await commitAll()
        const start = recordedAtStart(manifestWith({ 'a.txt': sha256('v1\r\n') }))
        await write('a.txt', 'v2\r\n')
        const ctx = ctxRecording({ 'a.txt': sha256('v2\r\n') })

        expect(await repairOverwrites(ctx, start, ctx.registries)).toEqual([])
        expect(await read('a.txt')).toBe('v2\r\n')
    })

    it('takes a file battlestack wrote as LF under core.autocrlf for pristine, as on a Windows runner', async () => {
        git('init', '-q')
        git('config', 'core.autocrlf', 'true')
        await write('a.txt', 'v1\n')
        await commitAll()
        const start = recordedAtStart(manifestWith({ 'a.txt': sha256('v1\n') }))
        await write('a.txt', 'v2\n')
        const ctx = ctxRecording({ 'a.txt': sha256('v2\n') })

        expect(await repairOverwrites(ctx, start, ctx.registries)).toEqual([])
        expect(await read('a.txt')).toBe('v2\n')
    })

    it('reads HEAD with the attributes of the file\'s repository path in a subdirectory project', async () => {
        git('init', '-q')
        await write('apps/web/.gitattributes', '/a.txt text eol=crlf\n')
        await write('apps/web/a.txt', 'v1\r\n')
        await commitAll()
        const start = recordedAtStart(manifestWith({ 'a.txt': sha256('v1\r\n') }))
        await write('apps/web/a.txt', 'v2\r\n')
        const ctx = ctxRecording({ 'a.txt': sha256('v2\r\n') }, path.join(projectDir, 'apps/web'))

        expect(await repairOverwrites(ctx, start, ctx.registries)).toEqual([])
        expect(await read('apps/web/a.txt')).toBe('v2\r\n')
    })

    it('works on a project in a subdirectory of the repository', async () => {
        git('init', '-q')
        await write('apps/web/Dockerfile', 'FROM node\nCOPY patches/ ./patches/\n')
        await commitAll()
        const web = path.join(projectDir, 'apps/web')
        const start = recordedAtStart(manifestWith({ Dockerfile: sha256('FROM node\n') }))
        await write('apps/web/Dockerfile', 'FROM node:24\n')
        const ctx = ctxRecording({ Dockerfile: sha256('FROM node:24\n') }, web)

        expect(await repairOverwrites(ctx, start, ctx.registries)).toEqual([{ rel: 'Dockerfile', featureId: 'test:feat', outcome: 'staged' }])
        expect(lf(await read('apps/web/Dockerfile'))).toBe('FROM node\nCOPY patches/ ./patches/\n')
        expect(await read('apps/web/.battlestack/pull/Dockerfile.new')).toBe('FROM node:24\n')
    })

    it('leaves the feature output alone under --force and --overwrite', async () => {
        git('init', '-q')
        await write('Dockerfile', 'FROM node\nCOPY patches/ ./patches/\n')
        await commitAll()
        const start = recordedAtStart(manifestWith({ Dockerfile: sha256('FROM node\n') }))
        await write('Dockerfile', 'FROM node:24\n')

        const overwrite = ctxRecording({ Dockerfile: sha256('FROM node:24\n') }, projectDir, { overwrite: true })
        expect(await repairOverwrites(overwrite, start, overwrite.registries)).toEqual([])
        expect(await read('Dockerfile')).toBe('FROM node:24\n')

        // --force keeps the output too, but saves the local version, as the drift-aware writers do.
        const force = ctxRecording({ Dockerfile: sha256('FROM node:24\n') }, projectDir, { force: true })
        expect((await repairOverwrites(force, start, force.registries)).map((r) => r.outcome)).toEqual(['backed up'])
        expect(await read('Dockerfile')).toBe('FROM node:24\n')
        expect(lf(await read(path.join('.battlestack', 'pull', 'Dockerfile.bak')))).toBe('FROM node\nCOPY patches/ ./patches/\n')
    })

    it('puts back the record of the feature that wrote the file, not another tracker\'s', async () => {
        git('init', '-q')
        await write('Dockerfile', 'FROM node\nCOPY patches/ ./patches/\n')
        await commitAll()
        const manifest = manifestWith({})
        manifest.features = [
            { id: 'test:x:other', version: '1.0.0', files: { Dockerfile: sha256('FROM other\n') } },
            { id: 'test:x:feat', version: '1.0.0', files: { Dockerfile: sha256('FROM node\n') } },
        ]
        const start = recordedAtStart(manifest)
        await write('Dockerfile', 'FROM node:24\n')
        // State maps key on bare ids while the manifest records fqids.
        const ctx = ctxRecording({}, projectDir)
        ctx.state = { 'files:x:other': { Dockerfile: sha256('FROM other\n') }, 'files:x:feat': { Dockerfile: sha256('FROM node:24\n') } }
        for (const id of ['x:other', 'x:feat']) {
            ctx.registries.features.register({ id, label: id, version: '1.0.0', stage: 0, async execute() {} } as never, { plugin: 'p', namespace: 'test' })
        }

        expect(await repairOverwrites(ctx, start, ctx.registries)).toEqual([{ rel: 'Dockerfile', featureId: 'x:feat', outcome: 'staged' }])
        expect(ctx.state['files:x:feat']).toEqual({ Dockerfile: sha256('FROM node\n') })
        expect(ctx.state['files:x:other']).toEqual({ Dockerfile: sha256('FROM other\n') })
    })
})

describe('report', () => {
    it('needs attention for conflicts, staged files, actions and a failed lint, not for clean merges', () => {
        expect(needsAttention({ ...EMPTY, merged: ['a'] })).toBe(false)
        expect(needsAttention({ ...EMPTY, conflicts: ['a'] })).toBe(true)
        expect(needsAttention({ ...EMPTY, actions: ['set a variable'] })).toBe(true)
        expect(needsAttention({ ...EMPTY, formatError: 'eslint exited 1' })).toBe(true)
    })

    it('explains how to resolve each kind of leftover', () => {
        const text = renderReport({ ...EMPTY, conflicts: ['a.ts'], staged: ['b.ts'], actions: ['Set `X`.'] })
        expect(text).toContain('## Conflicts')
        expect(text).toContain('git diff --check')
        expect(text).toContain('.battlestack/pull/<path>.new')
        expect(text).toContain('- Set `X`.')
        expect(text).not.toMatch(/—/)
    })

    it('lists a restored file once under New files', () => {
        const text = renderReport({ ...EMPTY, added: ['a.ts'], restored: ['a.ts'] })
        expect(text.match(/^- `a\.ts`$/gm)).toHaveLength(1)
    })
})

describe('pull with --allow-dirty', () => {
    it('skips the overwrite check, so an uncommitted edit is never treated as feature output', async () => {
        git('init', '-q')
        await write('a.ts', 'committed, already edited\n')
        git('add', '-A')
        git('commit', '-q', '-m', 'init')
        await write('a.ts', 'uncommitted edit\n')

        const safety = await preflight(projectDir, manifestWith({ 'a.ts': sha256('scaffold\n') }), { allowDirty: true })
        expect(safety.clean).toBe(false)
        // pull runs repairOverwrites only when `clean`, so the uncommitted bytes stay as they are.
        expect(await read('a.ts')).toBe('uncommitted edit\n')
    })
})
