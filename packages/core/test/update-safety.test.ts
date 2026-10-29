import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BASE_DIR, findBase, hasConflictMarkers, storeBase, threeWayMerge } from '../src/utils/merge.js'
import { copyTemplateDirRecorded, updateLedger, UPDATING_STATE_KEY, writeRecorded } from '../src/utils/templates.js'
import { defaultPort, freezePort, resetFrozenPorts } from '../src/utils/port-alloc.js'
import { exists } from '../src/utils/fs.js'
import { BattlestackRegistries } from '../src/registry.js'
import type { RunContext } from '../src/types/run-context.js'

const origin = { plugin: 'test-plugin', namespace: 'test' }
const registries = new BattlestackRegistries()
registries.frameworks.register({ id: 'safety-test', label: 'safety-test', supportedFeatures: [] }, origin)
registries.templates.register({
    id: 'safety-test', label: 'safety-test', framework: 'safety-test', requiredFeatures: [], optionalFeatures: [],
}, origin)

let projectDir: string
let templateDir: string

const sha256 = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex')

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

function updatingCtx(files: Record<string, Record<string, string>> = {}): RunContext {
    const state: Record<string, unknown> = { packageManager: 'pnpm', [UPDATING_STATE_KEY]: true }
    for (const [feature, map] of Object.entries(files)) state[`files:${feature}`] = { ...map }
    return {
        projectName: 'demo',
        projectDir,
        framework: registries.frameworks.get('safety-test'),
        template: registries.templates.get('safety-test'),
        enabledFeatures: new Set(),
        state,
        debug: false,
        dryRun: false,
        registries,
    }
}

const BASE = 'line one\nline two\nline three\nline four\nline five\n'

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-safety-'))
    templateDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-safety-src-'))
})

afterEach(async () => {
    resetFrozenPorts()
    await rm(projectDir, { recursive: true, force: true })
    await rm(templateDir, { recursive: true, force: true })
})

describe('threeWayMerge', () => {
    it('keeps both sides when they touch different lines', async () => {
        const ours = BASE.replace('line one', 'line one, ours')
        const theirs = BASE.replace('line five', 'line five, upstream')
        const merged = await threeWayMerge(Buffer.from(ours), Buffer.from(BASE), Buffer.from(theirs), { current: 'a', base: 'b', upstream: 'c' })
        expect(merged?.conflicts).toBe(false)
        expect(merged?.content.toString()).toBe(BASE.replace('line one', 'line one, ours').replace('line five', 'line five, upstream'))
    })

    it('writes diff3 markers with the base section when both change the same line', async () => {
        const merged = await threeWayMerge(
            Buffer.from(BASE.replace('line three', 'ours')),
            Buffer.from(BASE),
            Buffer.from(BASE.replace('line three', 'theirs')),
            { current: 'x (yours)', base: 'x (upstream before)', upstream: 'x (upstream now)' },
        )
        const text = merged!.content.toString()
        expect(merged?.conflicts).toBe(true)
        expect(text).toContain('<<<<<<< x (yours)')
        expect(text).toContain('||||||| x (upstream before)\nline three')
        expect(hasConflictMarkers(text)).toBe(true)
    })
})

describe('findBase', () => {
    it('reads a stored base by hash before looking at git', async () => {
        await storeBase(projectDir, Buffer.from(BASE))
        expect((await findBase(projectDir, 'f.txt', [sha256(BASE)]))?.toString()).toBe(BASE)
        expect(await exists(path.join(projectDir, BASE_DIR, sha256(BASE)))).toBe(true)
    })

    it('finds the recorded upstream version in git history', async () => {
        git('init', '-q')
        await write('f.txt', BASE)
        git('add', '-A')
        git('commit', '-q', '-m', 'scaffold')
        await write('f.txt', BASE.replace('line two', 'edited'))
        git('commit', '-q', '-am', 'edit')
        expect((await findBase(projectDir, 'f.txt', [sha256(BASE)]))?.toString()).toBe(BASE)
    })

    it('finds a file battlestack wrote as LF under core.autocrlf, as on a Windows runner', async () => {
        git('init', '-q')
        git('config', 'core.autocrlf', 'true')
        await write('f.txt', BASE)
        git('add', '-A')
        git('commit', '-q', '-m', 'scaffold')
        expect((await findBase(projectDir, 'f.txt', [sha256(BASE)]))?.toString()).toBe(BASE)
    })

    it('finds it for a project in a subdirectory, as checkout wrote it', async () => {
        git('init', '-q')
        const crlf = BASE.replaceAll('\n', '\r\n')
        // Only a lookup by the file's repository path matches this pattern.
        await write('apps/web/.gitattributes', '/f.txt text eol=crlf\n')
        await write('apps/web/f.txt', crlf)
        await write('f.txt', 'a root file of the same name\n')
        git('add', '-A')
        git('commit', '-q', '-m', 'scaffold')
        for (const edit of ['edited once', 'edited twice']) {
            await write('apps/web/f.txt', crlf.replace('line two', edit))
            git('commit', '-q', '-am', edit)
        }
        const found = await findBase(path.join(projectDir, 'apps/web'), 'f.txt', [sha256(crlf)])
        expect(found?.toString()).toBe(crlf)
    })

    it('returns null when no version in history matches', async () => {
        git('init', '-q')
        await write('f.txt', BASE)
        git('add', '-A')
        git('commit', '-q', '-m', 'scaffold')
        expect(await findBase(projectDir, 'f.txt', [sha256('something else')])).toBeNull()
        expect(await findBase(projectDir, 'never-committed.txt', [sha256(BASE)])).toBeNull()
    })
})

describe('writes during an update', () => {
    it('stages a new feature\'s file instead of replacing an untracked one', async () => {
        await write('server/routes/_ws.ts', 'team realtime socket\n')
        await writeFile(path.join(templateDir, 'placeholder'), '')
        await mkdir(path.join(templateDir, 'server', 'routes'), { recursive: true })
        await writeFile(path.join(templateDir, 'server', 'routes', '_ws.ts'), 'boilerplate chat socket\n')

        const ctx = updatingCtx()
        await copyTemplateDirRecorded(ctx, 'test:chat', templateDir)

        expect(await read('server/routes/_ws.ts')).toBe('team realtime socket\n')
        expect(await read('.battlestack/pull/server/routes/_ws.ts.new')).toBe('boilerplate chat socket\n')
        expect(updateLedger(ctx).staged).toContain('server/routes/_ws.ts')
    })

    it('merges an edited file against its recorded upstream version', async () => {
        await storeBase(projectDir, Buffer.from(BASE))
        await write('Dockerfile', BASE.replace('line two', 'COPY patches/ ./patches/'))
        const ctx = updatingCtx({ 'test:docker': { Dockerfile: sha256(BASE) } })

        await writeRecorded(ctx, 'test:docker', 'Dockerfile', BASE.replace('line five', 'line five, pinned'))

        expect(await read('Dockerfile')).toBe(BASE.replace('line two', 'COPY patches/ ./patches/').replace('line five', 'line five, pinned'))
        expect(updateLedger(ctx).merged).toContain('Dockerfile')
    })

    it('treats a file another feature recorded as pristine when it matches that record', async () => {
        const old = 'deploy: old\n'
        await write('.github/workflows/development.yml', old)
        const ctx = updatingCtx({ 'test:github': { '.github/workflows/development.yml': sha256(old) } })

        await writeRecorded(ctx, 'test:deploy', '.github/workflows/development.yml', 'deploy: new\n')

        expect(await read('.github/workflows/development.yml')).toBe('deploy: new\n')
        expect(updateLedger(ctx).staged).toEqual([])
    })

    describe('on a core.autocrlf checkout, as on Windows', () => {
        // Checked out again, so the working copy is CRLF while the recorded hash is of the LF bytes.
        async function checkedOut(content: string): Promise<void> {
            git('init', '-q')
            git('config', 'core.autocrlf', 'true')
            await write('f.txt', content)
            git('add', '-A')
            git('commit', '-q', '-m', 'scaffold')
            await rm(path.join(projectDir, 'f.txt'))
            git('checkout', '--', 'f.txt')
            expect(await read('f.txt')).toBe(content.replaceAll('\n', '\r\n'))
        }

        it('updates an untouched file instead of merging it into one conflict', async () => {
            await checkedOut(BASE)
            const ctx = updatingCtx({ 'test:f': { 'f.txt': sha256(BASE) } })

            await writeRecorded(ctx, 'test:f', 'f.txt', BASE.replace('line five', 'line five, new'))

            expect(await read('f.txt')).toBe(BASE.replace('line five', 'line five, new'))
            expect(updateLedger(ctx)).toMatchObject({ conflicts: [], staged: [] })
        })

        it('merges an edited file line by line', async () => {
            await checkedOut(BASE)
            const edited = BASE.replace('line two', 'edited').replaceAll('\n', '\r\n')
            await write('f.txt', edited)
            const ctx = updatingCtx({ 'test:f': { 'f.txt': sha256(BASE) } })

            await writeRecorded(ctx, 'test:f', 'f.txt', BASE.replace('line five', 'line five, new'))

            expect(await read('f.txt')).toBe(BASE.replace('line two', 'edited').replace('line five', 'line five, new'))
            expect(updateLedger(ctx)).toMatchObject({ conflicts: [], merged: ['f.txt'] })
        })
    })

    it('outside an update, writes as before', async () => {
        await write('a.txt', 'local\n')
        const ctx = updatingCtx()
        ctx.state[UPDATING_STATE_KEY] = false
        await writeRecorded(ctx, 'test:a', 'a.txt', 'scaffold\n')
        expect(await read('a.txt')).toBe('scaffold\n')
    })
})

describe('defaultPort', () => {
    it('ignores a port frozen on this machine', () => {
        const hashed = defaultPort('demo', 'app')
        freezePort('demo', 'app', hashed + 1)
        expect(defaultPort('demo', 'app')).toBe(hashed)
    })
})

describe('pruneBases', () => {
    it('keeps the README and the bases still needed, and removes the directory once none are', async () => {
        const { pruneBases } = await import('../src/utils/merge.js')
        const keep = await storeBase(projectDir, Buffer.from('keep\n'))
        const drop = await storeBase(projectDir, Buffer.from('drop\n'))
        await pruneBases(projectDir, new Set([keep]))
        expect(await exists(path.join(projectDir, BASE_DIR, drop))).toBe(false)
        expect(await exists(path.join(projectDir, BASE_DIR, 'README.md'))).toBe(true)
        await pruneBases(projectDir, new Set())
        expect(await exists(path.join(projectDir, BASE_DIR))).toBe(false)
    })
})
