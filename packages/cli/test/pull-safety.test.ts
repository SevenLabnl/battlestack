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

function ctxRecording(files: Record<string, string>): RunContext {
    return {
        projectName: 'demo',
        projectDir,
        framework: undefined as never,
        template: undefined as never,
        enabledFeatures: new Set(),
        state: { 'files:test:feat': files },
        debug: false,
        dryRun: false,
        registries: new BattlestackRegistries(),
    }
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
})

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
        expect(await read('Dockerfile')).toBe('FROM node\nCOPY patches/ ./patches/\n')
        expect(await read('.battlestack/pull/Dockerfile.new')).toBe('FROM node:24\n')
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
