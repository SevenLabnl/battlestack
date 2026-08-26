/**
 * Feature version gate.
 *
 *   pnpm bump:check [baseRef]   CI gate: fail when a changed feature was not bumped
 *   pnpm bump --list            every feature, version, status
 *   pnpm bump --changed         only features with changes
 *   pnpm bump <id> <level>      rewrite one version (patch|minor|major)
 *
 * Status markers:
 *   ! changed   owned files differ from base, version identical
 *   ^ bumped    version differs from base
 *   + new       feature file absent at base
 *   . clean     no change
 *
 * Two rules are enforced. A feature that changed what it emits must be bumped.
 * A feature that changed `collectDocs` or `collectEnv` must also bump the
 * feature that writes the aggregated file, listed in WRITERS.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type Level = 'patch' | 'minor' | 'major'
type Status = 'changed' | 'bumped' | 'new' | 'clean'

interface FeatureFile {
    id: string
    version: string
    file: string
    pkgRoot: string
    ownedPaths: string[]
    status: Status
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LEVELS: Level[] = ['patch', 'minor', 'major']

const ID_RE = /\bid:\s*'([^']+)'/
const ID_CONST_RE = /\bid:\s*([A-Za-z_$][\w$]*)\s*,/
const VERSION_RE = /(\n\s*version:\s*')(\d+\.\d+\.\d+)(')/
const TPL_NAME_RE = /(?:templatesDir\(\s*import\.meta\.url\s*(?:,\s*'\.\.'\s*)*,\s*'templates'\s*,|emitTemplate(?:Update)?(?:Many)?\(\s*ctx\s*,\s*'[^']*'\s*,\s*import\.meta\.url\s*,)\s*(\[[^\]]*\]|`[^`]*`|'[^']*')/g

/** Aggregating hook -> id of the feature that writes the file it feeds. */
const WRITERS: Record<string, string> = {
    collectDocs: 'nuxt4:docs',
    collectEnv: 'shared:env',
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2)
    if (argv.includes('--check')) return runCheck(argv)

    const changed = gitChangedFiles('HEAD')
    const features = (await collectFeatures(changed, 'HEAD')).sort(byStatusThenId)

    if (argv.includes('--list') || argv.includes('-l')) return printTable(features)
    if (argv.includes('--changed') || argv.includes('-c')) {
        const dirty = features.filter((f) => f.status === 'changed' || f.status === 'new')
        return printTable(dirty.length ? dirty : features)
    }

    const [idArg, levelArg] = argv.filter((a) => !a.startsWith('-'))
    if (!idArg || !levelArg) {
        console.log('usage: pnpm bump <feature-id> <patch|minor|major> | --list | --changed')
        printTable(features)
        return
    }
    if (!LEVELS.includes(levelArg as Level)) fail(`invalid level "${levelArg}", use ${LEVELS.join('|')}`)
    const target = features.find((f) => f.id === idArg)
    if (!target) fail(`no feature with id "${idArg}", run \`pnpm bump --list\``)
    await applyBump(target, levelArg as Level)
}

/**
 * Base ref precedence: `--check <ref>` -> $BUMP_CHECK_BASE -> latest release tag
 * -> first existing of origin/main, origin/master, main, master.
 * Bypass with a truthy $SKIP_BUMP_CHECK.
 */
async function runCheck(argv: string[]): Promise<void> {
    if (truthy(process.env.SKIP_BUMP_CHECK)) {
        console.log('bump check bypassed via SKIP_BUMP_CHECK')
        return
    }
    const argRef = argv[argv.indexOf('--check') + 1]
    const refArg = argRef && !argRef.startsWith('-') ? argRef : undefined
    const tag = latestReleaseTag()
    // `|| undefined`, not `??`: CI passes an empty string when there is no PR base ref.
    const envBase = process.env.BUMP_CHECK_BASE?.trim() || undefined
    const base = refArg
        ?? envBase
        ?? tag
        ?? resolveRef('origin/main', 'origin/master', 'main', 'master')

    console.log(`bump check, base ref: ${base}`)
    const changed = gitChangedFiles(base)
    const features = await collectFeatures(changed, base)
    const offenders = features.filter((f) => f.status === 'changed')
    const writerOffenders = await collectWriterOffenders(features, base)
    if (offenders.length === 0 && writerOffenders.length === 0) {
        console.log('OK: every changed feature carries a version bump')
        return
    }

    for (const f of offenders) {
        console.log(`\nFAIL ${f.id} changed but is still ${f.version}`)
        console.log(`  files: ${f.ownedPaths.map(rel).join(', ')}`)
        console.log(`  fix:   pnpm bump ${f.id} <patch|minor|major>`)
    }
    for (const w of writerOffenders) {
        console.log(`\nFAIL ${w.writerId} must be bumped: ${w.hook} changed in ${w.sources.join(', ')}`)
        console.log(`  ${w.writerId} writes the file those hooks feed, and \`pull\` version-gates on the writer.`)
        console.log(`  fix:   pnpm bump ${w.writerId} patch`)
    }
    console.log('\nbypass (sparingly): SKIP_BUMP_CHECK=1')
    process.exit(1)
}

interface WriterOffender {
    writerId: string
    hook: string
    sources: string[]
}

/** Features whose aggregating hook changed while the writing feature stayed put. */
async function collectWriterOffenders(features: FeatureFile[], base: string): Promise<WriterOffender[]> {
    const out: WriterOffender[] = []
    for (const [hook, writerId] of Object.entries(WRITERS)) {
        const writer = features.find((f) => f.id === writerId)
        if (writer && (writer.status === 'bumped' || writer.status === 'new')) continue

        const sources: string[] = []
        for (const f of features) {
            if (f.id === writerId) continue
            const now = extractHook(await readFile(f.file, 'utf8'), hook)
            const then = extractHook(gitShow(f.file, base) ?? '', hook)
            if (now !== then) sources.push(f.id)
        }
        if (sources.length === 0) continue
        if (writer) {
            out.push({ writerId, hook, sources: sources.sort() })
            continue
        }
        // The writer lives in another repo, so this gate cannot check it.
        console.log(`\nWARN ${hook} changed in ${sources.sort().join(', ')}`)
        console.log(`  ${writerId} writes the file those hooks feed and is not in this repo.`)
        console.log(`  Bump ${writerId} where it is defined, or existing projects keep the old text.`)
    }
    return out
}

/** Body of a `name(...) { ... }` member, or null when absent. Brace-matched. */
function extractHook(src: string, name: string): string | null {
    const at = new RegExp(`\\b${name}\\s*\\(`).exec(src)?.index
    if (at === undefined) return null
    const open = src.indexOf('{', at)
    if (open === -1) return null
    let depth = 0
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++
        else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1)
    }
    return null
}

async function collectFeatures(changed: Set<string>, ref: string): Promise<FeatureFile[]> {
    const out: FeatureFile[] = []
    for (const dir of await featureDirs()) {
        const pkgRoot = path.resolve(dir, '..', '..')
        for (const file of await walk(dir)) {
            if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue
            const raw = await readFile(file, 'utf8')
            const parsed = parseFeature(raw)
            if (!parsed) {
                if (VERSION_RE.test(raw)) console.log(`WARN ${rel(file)} has a version but no readable id, not checked`)
                continue
            }
            const { id, version } = parsed
            const ownedPaths = [file, ...templateDirs(pkgRoot, raw)]
            out.push({ id, version, file, pkgRoot, ownedPaths, status: classify(file, version, ownedPaths, changed, ref) })
        }
    }
    return out
}

/**
 * The `id` nearest above the `version`, so a `collectBuildSecrets` id cannot win.
 * `id: FEATURE_ID` resolves through the file's own `const FEATURE_ID = '...'`.
 */
function parseFeature(raw: string): { id: string, version: string } | null {
    const v = VERSION_RE.exec(raw)
    if (!v) return null
    const before = raw.slice(0, v.index)

    let id: string | null = null
    let at = -1
    for (const m of before.matchAll(new RegExp(ID_RE, 'g'))) {
        id = m[1]!
        at = m.index!
    }
    for (const m of before.matchAll(new RegExp(ID_CONST_RE, 'g'))) {
        if (m.index! < at) continue
        const resolved = new RegExp(`\\bconst\\s+${m[1]!}\\s*=\\s*'([^']+)'`).exec(raw)?.[1]
        if (resolved) {
            id = resolved
            at = m.index!
        }
    }
    return id ? { id, version: v[2]! } : null
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', 'templates', '.output'])

/** Every `<pkg>/src/features` in the repo, so one script serves either layout. */
async function featureDirs(depth = 3, dir = ROOT): Promise<string[]> {
    if (depth === 0) return []
    const out: string[] = []
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue
        const p = path.join(dir, e.name)
        const candidate = path.join(p, 'src', 'features')
        if (existsSync(candidate)) out.push(candidate)
        out.push(...await featureDirs(depth - 1, p))
    }
    return out
}

/** Template dirs a feature references, resolved under `<pkgRoot>/templates`. */
function templateDirs(pkgRoot: string, raw: string): string[] {
    const dirs = new Set<string>()
    const add = (name: string) => {
        // A dynamic segment (`chat/${transport}`) narrows to its static prefix.
        const stat_ = name.split('${')[0]!.split('/').filter(Boolean)
        if (stat_.length === 0) return
        const d = path.join(pkgRoot, 'templates', ...stat_)
        if (existsSync(d) && statSync(d).isDirectory()) dirs.add(d)
    }
    for (const m of raw.matchAll(TPL_NAME_RE)) {
        const tok = m[1]!
        const names = tok.startsWith('[') ? tok.split(',') : [tok]
        for (const n of names) {
            const cleaned = n.trim().replace(/^\[|\]$/g, '').trim().replace(/^['`]|['`]$/g, '')
            if (cleaned) add(cleaned)
        }
    }
    return [...dirs]
}

function classify(file: string, version: string, ownedPaths: string[], changed: Set<string>, ref: string): Status {
    const base = refVersion(file, ref)
    if (base === null) return 'new'
    if (base !== version) return 'bumped'
    return ownedPaths.some((p) => isPathChanged(p, changed)) ? 'changed' : 'clean'
}

function isPathChanged(p: string, changed: Set<string>): boolean {
    if (changed.has(p)) return true
    const prefix = p.endsWith(path.sep) ? p : p + path.sep
    for (const c of changed) if (c.startsWith(prefix)) return true
    return false
}

function git(args: string[]): string | null {
    try {
        return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
        return null
    }
}

function gitShow(file: string, ref: string): string | null {
    return git(['show', `${ref}:${path.relative(ROOT, file).split(path.sep).join('/')}`])
}

function gitChangedFiles(ref: string): Set<string> {
    const set = new Set<string>()
    const tracked = git(['diff', '--name-only', ref])
    const untracked = git(['ls-files', '--others', '--exclude-standard'])
    for (const block of [tracked, untracked]) {
        for (const line of (block ?? '').split('\n')) {
            const relPath = line.trim()
            if (relPath) set.add(path.join(ROOT, relPath))
        }
    }
    return set
}

function refVersion(file: string, ref: string): string | null {
    const content = gitShow(file, ref)
    if (content === null) return null
    return VERSION_RE.exec(content)?.[2] ?? null
}

function latestReleaseTag(): string | null {
    return git(['describe', '--tags', '--abbrev=0'])?.trim() || null
}

function resolveRef(...candidates: string[]): string {
    for (const c of candidates) {
        if (git(['rev-parse', '--verify', '--quiet', c]) !== null) return c
    }
    return 'HEAD'
}

async function walk(dir: string): Promise<string[]> {
    const out: string[] = []
    for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) out.push(...await walk(p))
        else out.push(p)
    }
    return out
}

async function applyBump(target: FeatureFile, level: Level): Promise<void> {
    const next = bump(target.version, level)
    const raw = await readFile(target.file, 'utf8')
    const updated = raw.replace(VERSION_RE, `$1${next}$3`)
    if (updated === raw) fail(`could not rewrite version in ${rel(target.file)}`)
    await writeFile(target.file, updated)
    console.log(`${target.id}  ${target.version} -> ${next}  ${rel(target.file)}`)
}

function bump(version: string, level: Level): string {
    const [major, minor, patch] = version.split('.').map(Number) as [number, number, number]
    if (level === 'major') return `${major + 1}.0.0`
    if (level === 'minor') return `${major}.${minor + 1}.0`
    return `${major}.${minor}.${patch + 1}`
}

const MARKERS: Record<Status, string> = { changed: '!', bumped: '^', new: '+', clean: '.' }

function printTable(features: FeatureFile[]): void {
    const width = Math.max(0, ...features.map((f) => f.id.length))
    for (const f of features) {
        console.log(`  ${MARKERS[f.status]} ${f.id.padEnd(width)}  ${f.version.padStart(8)}  ${f.status}`)
    }
    const changed = features.filter((f) => f.status === 'changed').length
    if (changed > 0) console.log(`\n${changed} feature(s) changed without a bump`)
}

function byStatusThenId(a: FeatureFile, b: FeatureFile): number {
    const order: Status[] = ['changed', 'new', 'bumped', 'clean']
    return order.indexOf(a.status) - order.indexOf(b.status) || a.id.localeCompare(b.id)
}

function truthy(v: string | undefined): boolean {
    return v != null && v !== '' && v !== '0' && v.toLowerCase() !== 'false'
}

function rel(p: string): string {
    return path.relative(ROOT, p)
}

function fail(msg: string): never {
    console.error(msg)
    process.exit(1)
}

await main()
