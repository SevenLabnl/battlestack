import { execFile, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { createPatch } from 'diff'
import { hashContent as sha256, toPosixRel } from '../manifest.js'
import { exists } from './fs.js'

const execFileAsync = promisify(execFile)

/** Upstream bytes a merged or conflicted file was last merged against, keyed by sha256. */
export const BASE_DIR = path.join('.battlestack', 'base')

const GIT_HISTORY_DEPTH = 200

const BASE_README = [
    '# Merge bases for `battlestack pull`',
    '',
    'Each file here is a version battlestack wrote into this project, named by its sha256.',
    'The next `battlestack pull` merges upstream changes into your edited files against them.',
    'Commit this directory and keep it: without it, those files can only be staged for a manual merge.',
    'battlestack removes entries it no longer needs.',
    '',
].join('\n')

const HASH_NAME = /^[0-9a-f]{64}$/

export async function storeBase(projectDir: string, content: Buffer): Promise<string> {
    const hash = sha256(content)
    const dir = path.join(projectDir, BASE_DIR)
    const dest = path.join(dir, hash)
    if (!(await exists(dest))) {
        await mkdir(dir, { recursive: true })
        await writeFile(dest, content)
    }
    const readme = path.join(dir, 'README.md')
    if (!(await exists(readme))) await writeFile(readme, BASE_README)
    return hash
}

/** Removes every stored base whose hash is not in `keep`, and the directory once none are left. */
export async function pruneBases(projectDir: string, keep: Set<string>): Promise<void> {
    const dir = path.join(projectDir, BASE_DIR)
    const entries = await readdir(dir).catch(() => [] as string[])
    let left = 0
    for (const name of entries) {
        if (!HASH_NAME.test(name)) continue
        if (keep.has(name)) left++
        else await rm(path.join(dir, name), { force: true })
    }
    if (entries.length > 0 && left === 0) await rm(dir, { recursive: true, force: true })
}

/**
 * The upstream content a drifted file started from: the bytes whose sha256 is one of
 * `hashes`, read from the base store or, for a project's first merge, from git history.
 */
export async function findBase(projectDir: string, rel: string, hashes: Iterable<string>): Promise<Buffer | null> {
    const wanted = new Set(hashes)
    if (wanted.size === 0) return null
    for (const hash of wanted) {
        const stored = path.join(projectDir, BASE_DIR, hash)
        if (await exists(stored)) return readFile(stored)
    }
    return findBaseInGit(projectDir, rel, wanted)
}

async function findBaseInGit(projectDir: string, rel: string, wanted: Set<string>): Promise<Buffer | null> {
    const posix = toPosixRel(rel)
    let prefix: string
    let log: string
    try {
        prefix = (await execFileAsync('git', ['rev-parse', '--show-prefix'], { cwd: projectDir })).stdout.trim()
        log = (await execFileAsync(
            'git',
            ['log', '--format=', '--raw', '--no-abbrev', `-n${GIT_HISTORY_DEPTH}`, '--', posix],
            { cwd: projectDir, maxBuffer: 64 * 1024 * 1024 },
        )).stdout
    } catch {
        return null
    }
    const blobs = new Set<string>()
    for (const line of log.split('\n')) {
        if (!line.startsWith(':')) continue
        const blob = line.split(' ')[3]
        if (blob && !/^0+$/.test(blob)) blobs.add(blob)
    }
    const read = (args: string[]): Promise<Buffer | null> => execFileAsync(
        'git',
        args,
        { cwd: projectDir, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
    ).then((r) => r.stdout, () => null)
    for (const blob of blobs) {
        // Committed bytes match a file battlestack wrote itself; --filters gives what checkout wrote.
        for (const args of [['cat-file', 'blob', blob], ['cat-file', '--filters', `--path=${prefix}${posix}`, blob]]) {
            const content = await read(args)
            if (content && wanted.has(sha256(content))) return content
        }
    }
    return null
}

/** Stages `upstream` as `.battlestack/pull/<rel>.new`, plus a `.patch` from `current` unless the file is binary. */
export async function stageUpstream(
    projectDir: string,
    rel: string,
    current: Buffer,
    upstream: Buffer,
    opts: { binary: boolean },
): Promise<void> {
    const staged = path.join(projectDir, '.battlestack', 'pull', rel)
    await mkdir(path.dirname(staged), { recursive: true })
    await writeFile(`${staged}.new`, upstream)
    if (opts.binary) {
        await rm(`${staged}.patch`, { force: true })
        return
    }
    const patch = createPatch(toPosixRel(rel), current.toString('utf8'), upstream.toString('utf8'), 'current', 'new')
    await writeFile(`${staged}.patch`, patch, 'utf8')
}

export interface MergeResult {
    content: Buffer
    conflicts: boolean
}

/** diff3-style three-way merge through `git merge-file`. Null when git is unavailable. */
export async function threeWayMerge(
    current: Buffer,
    base: Buffer,
    upstream: Buffer,
    labels: { current: string, base: string, upstream: string },
): Promise<MergeResult | null> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-merge-'))
    try {
        const files = { current: path.join(dir, 'current'), base: path.join(dir, 'base'), upstream: path.join(dir, 'upstream') }
        await writeFile(files.current, current)
        await writeFile(files.base, base)
        await writeFile(files.upstream, upstream)
        const result = spawnSync('git', [
            'merge-file', '-p', '--diff3',
            '-L', labels.current, '-L', labels.base, '-L', labels.upstream,
            files.current, files.base, files.upstream,
        ], { maxBuffer: 64 * 1024 * 1024 })
        // Exit status is the conflict count; a negative or missing status is an error.
        if (result.error || result.status === null || result.status < 0 || result.status > 127) return null
        return { content: result.stdout, conflicts: result.status > 0 }
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
}

const MARKER = /^(<{7}|>{7}) /m

export function hasConflictMarkers(content: string): boolean {
    return MARKER.test(content)
}
