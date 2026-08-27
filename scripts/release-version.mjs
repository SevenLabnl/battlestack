/**
 * Lockstep version tooling for the publishable workspace packages.
 *
 *   node scripts/release-version.mjs --print
 *   node scripts/release-version.mjs --names
 *   node scripts/release-version.mjs --check
 *   node scripts/release-version.mjs --set 0.2.0
 *   node scripts/release-version.mjs --bump minor
 *   node scripts/release-version.mjs --bump prerelease --preid next
 *   node scripts/release-version.mjs --changelog
 *
 * `--check` is a CI gate: every publishable package must carry the same
 * version and reference its siblings as `workspace:*`.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md')
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/
const VERSION_FIELD_RE = /("version"\s*:\s*")([^"]+)(")/
const LEVELS = ['major', 'minor', 'patch', 'premajor', 'preminor', 'prepatch', 'prerelease']
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

const invokedDirectly = process.argv[1]
    ? import.meta.url === pathToFileURL(process.argv[1]).href
    : false

if (invokedDirectly) {
    try {
        main()
    } catch (error) {
        console.error(`release-version: ${error.message}`)
        process.exit(1)
    }
}

function main() {
    const argv = process.argv.slice(2)
    const packages = publishablePackages()

    if (has(argv, '--print')) return console.log(lockstepVersion(packages))
    if (has(argv, '--names')) return console.log(packages.map((p) => p.name).join('\n'))
    if (has(argv, '--check')) return check(packages)
    if (has(argv, '--changelog')) return writeChangelog(lockstepVersion(packages))

    const set = value(argv, '--set')
    const level = value(argv, '--bump')
    if (!set && !level) fail('usage: --print | --names | --check | --set <version> | --bump <level> [--preid <id>] | --changelog')

    const current = lockstepVersion(packages)
    const next = set ?? bump(current, level, value(argv, '--preid') ?? 'next')
    if (!SEMVER_RE.test(next)) fail(`"${next}" is not a semver version`)
    if (next === current) fail(`already at ${current}`)

    for (const pkg of packages) setVersion(pkg, next)
    console.log(`${current} -> ${next} across ${packages.length} packages`)
    console.log(next)
}

/** Workspace packages under `packages/` that are not marked private. */
function publishablePackages() {
    const dir = path.join(ROOT, 'packages')
    const out = []
    for (const name of readdirSync(dir)) {
        const file = path.join(dir, name, 'package.json')
        if (!existsSync(file)) continue
        const raw = readFileSync(file, 'utf8')
        const json = JSON.parse(raw)
        if (json.private) continue
        out.push({ name: json.name, file, raw, json })
    }
    if (out.length === 0) fail('no publishable packages found under packages/')
    return out.sort((a, b) => a.name.localeCompare(b.name))
}

function lockstepVersion(packages) {
    const versions = new Set(packages.map((p) => p.json.version))
    if (versions.size !== 1) {
        for (const p of packages) console.error(`  ${p.json.version}  ${p.name}`)
        fail(`versions are out of sync across ${packages.length} packages`)
    }
    const version = [...versions][0]
    if (!SEMVER_RE.test(version)) fail(`"${version}" is not a semver version`)
    return version
}

function check(packages) {
    const version = lockstepVersion(packages)
    const names = new Set(packages.map((p) => p.name))
    const problems = []

    for (const pkg of packages) {
        for (const field of DEP_FIELDS) {
            for (const [dep, range] of Object.entries(pkg.json[field] ?? {})) {
                if (!names.has(dep)) continue
                if (!String(range).startsWith('workspace:')) {
                    problems.push(`${pkg.name} ${field}.${dep} is "${range}", expected "workspace:*"`)
                }
            }
        }
    }

    const binPackages = packages.filter((p) => Object.keys(p.json.bin ?? {}).length > 0)
    if (binPackages.length === 0) {
        problems.push('no publishable package declares "bin", so `npx battlestack` would resolve to nothing')
    }

    if (problems.length) {
        for (const p of problems) console.error(`FAIL ${p}`)
        fail('the publishable set is not releasable')
    }

    console.log(`OK: ${packages.length} packages all at ${version}`)
    for (const pkg of packages) {
        const bins = Object.keys(pkg.json.bin ?? {})
        console.log(`  ${version}  ${pkg.name}${bins.length ? `  bin: ${bins.join(', ')}` : ''}`)
    }
    if (tagExists(`v${version}`)) console.log(`\nnote: tag v${version} already exists, bump before releasing`)
}

/** Rewrites the version field in place, leaving the rest of the file byte-identical. */
function setVersion(pkg, next) {
    if (!VERSION_FIELD_RE.test(pkg.raw)) fail(`${pkg.file} has no "version" field`)
    const rewritten = pkg.raw.replace(VERSION_FIELD_RE, `$1${next}$3`)
    if (JSON.parse(rewritten).version !== next) {
        fail(`${pkg.file}: the first "version" field is not the package version`)
    }
    writeFileSync(pkg.file, rewritten)
}

export function bump(current, level, preid) {
    if (!LEVELS.includes(level)) fail(`invalid level "${level}", use ${LEVELS.join('|')}`)
    const [, major, minor, patch, pre] = SEMVER_RE.exec(current)
    const n = [Number(major), Number(minor), Number(patch)]

    if (level === 'major') return pre && n[1] === 0 && n[2] === 0 ? `${n[0]}.0.0` : `${n[0] + 1}.0.0`
    if (level === 'minor') return pre && n[2] === 0 ? `${n[0]}.${n[1]}.0` : `${n[0]}.${n[1] + 1}.0`
    if (level === 'patch') return pre ? `${n[0]}.${n[1]}.${n[2]}` : `${n[0]}.${n[1]}.${n[2] + 1}`
    if (level === 'premajor') return `${n[0] + 1}.0.0-${preid}.0`
    if (level === 'preminor') return `${n[0]}.${n[1] + 1}.0-${preid}.0`
    if (level === 'prepatch') return `${n[0]}.${n[1]}.${n[2] + 1}-${preid}.0`

    if (!pre) return `${n[0]}.${n[1]}.${n[2] + 1}-${preid}.0`
    const parts = pre.split('.')
    const last = Number(parts.at(-1))
    if (parts[0] !== preid) return `${n[0]}.${n[1]}.${n[2]}-${preid}.0`
    if (!Number.isInteger(last)) return `${n[0]}.${n[1]}.${n[2]}-${pre}.0`
    return `${n[0]}.${n[1]}.${n[2]}-${parts.slice(0, -1).join('.')}.${last + 1}`
}

/** Prepends a stanza of commit subjects since the previous release tag. */
function writeChangelog(version) {
    const previous = previousReleaseTag()
    const range = previous ? `${previous}..HEAD` : 'HEAD'
    const log = git(['log', '--no-merges', '--pretty=format:- %s (%h)', range]) ?? ''
    const entries = log.trim() || '- no commits recorded'
    const date = git(['log', '-1', '--pretty=format:%cs'])?.trim() ?? ''
    const compare = previous ? `\n\n[Full changelog](https://github.com/SevenLabnl/battlestack/compare/${previous}...v${version})` : ''
    const stanza = `## v${version}${date ? ` (${date})` : ''}\n\n${entries}${compare}\n`

    const existing = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, 'utf8') : '# Changelog\n'
    const [heading, ...rest] = existing.split('\n')
    writeFileSync(CHANGELOG, `${heading}\n\n${stanza}\n${rest.join('\n').replace(/^\n+/, '')}`)
    console.log(`CHANGELOG.md: added v${version} (${entries.split('\n').length} entries since ${previous ?? 'the first commit'})`)
}

/** Nearest release tag reachable from HEAD, so a stanza covers this line of history only. */
function previousReleaseTag() {
    const described = git(['describe', '--tags', '--abbrev=0', '--match', 'v*'])?.trim()
    if (described) return described
    const tags = git(['tag', '--list', 'v*', '--sort=-v:refname'])?.trim()
    return tags ? tags.split('\n')[0].trim() : null
}

function tagExists(tag) {
    return git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]) !== null
}

function git(args) {
    try {
        return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
        return null
    }
}

function has(argv, flag) {
    return argv.includes(flag)
}

function value(argv, flag) {
    const i = argv.indexOf(flag)
    return i === -1 ? undefined : argv[i + 1]
}

function fail(message) {
    throw new Error(message)
}
