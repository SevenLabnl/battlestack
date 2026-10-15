import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { exists } from './fs.js'

/** Upstream bytes a merged or conflicted file was last merged against, keyed by sha256. */
export const BASE_DIR = path.join('.battlestack', 'base')

const GIT_HISTORY_DEPTH = 200

function sha256(content: string | Buffer): string {
    return createHash('sha256').update(content).digest('hex')
}

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

function findBaseInGit(projectDir: string, rel: string, wanted: Set<string>): Buffer | null {
    const posix = rel.split(path.sep).join('/')
    let commits: string[]
    try {
        commits = execFileSync(
            'git',
            ['log', '--format=%H', `-n${GIT_HISTORY_DEPTH}`, '--', posix],
            { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
        ).split('\n').filter(Boolean)
    } catch {
        return null
    }
    for (const commit of commits) {
        const blob = spawnSync('git', ['show', `${commit}:${posix}`], { cwd: projectDir, maxBuffer: 64 * 1024 * 1024 })
        if (blob.status !== 0) continue
        if (wanted.has(sha256(blob.stdout))) return blob.stdout
    }
    return null
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
