// Proves the publish path actually works: pack all 5 workspace packages with
// `pnpm pack` (which rewrites `workspace:*` deps to real semver ranges, same
// as a real `pnpm publish` would), install the tarballs — and ONLY the
// tarballs, nothing from the workspace — into a fresh throwaway project, then
// run the installed `battlestack` binary's `--version` and `--help`. The
// binary belongs to the unscoped `battlestack` wrapper (the only package with
// bin entries), so a passing run also proves the wrapper → @battlestack/cli
// import chain.
//
// This does NOT scaffold a project end-to-end (that's another track's e2e
// smoke test); it proves the narrower, blocking thing this track owns: the
// binary executes post-install and the preset's template payload is present
// in its installed package.
//
// Assumes `pnpm build` already ran (the root `pack:smoke` script chains
// `pnpm build && node scripts/pack-smoke.mjs`).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Dependency order matters for nothing here (pack doesn't need it, unlike
// build) but is kept for readable log output.
const PACKAGES = [
    { dir: 'packages/core', name: '@battlestack/core' },
    { dir: 'packages/tui', name: '@battlestack/tui' },
    { dir: 'packages/preset-nuxt4', name: '@battlestack/preset-nuxt4' },
    { dir: 'packages/cli', name: '@battlestack/cli' },
    { dir: 'packages/battlestack', name: 'battlestack' },
]

function run(cmd, args, opts = {}) {
    return execFileSync(cmd, args, { encoding: 'utf8', cwd: root, ...opts })
}

function log(msg) {
    console.log(`[pack-smoke] ${msg}`)
}

const work = mkdtempSync(path.join(tmpdir(), 'battlestack-pack-smoke-'))
const tarballDir = path.join(work, 'tarballs')
const consumerDir = path.join(work, 'consumer')
mkdirSync(tarballDir, { recursive: true })
mkdirSync(consumerDir, { recursive: true })
log(`work dir: ${work}`)

// --- 1. pack every package -------------------------------------------------
const tarballs = {}
for (const pkg of PACKAGES) {
    log(`packing ${pkg.name}...`)
    const out = run('pnpm', ['pack', '--pack-destination', tarballDir], {
        cwd: path.join(root, pkg.dir),
    })
    const lastLine = out.trim().split('\n').at(-1).trim()
    if (!existsSync(lastLine)) {
        throw new Error(`pnpm pack for ${pkg.name} did not report a tarball path: ${out}`)
    }
    tarballs[pkg.name] = lastLine
    log(`  -> ${path.basename(lastLine)}`)
}

// --- 2. verify templates shipped in the preset tarball ----------------------
{
    const listing = run('tar', ['tzf', tarballs['@battlestack/preset-nuxt4']])
    const templateFiles = listing.split('\n').filter((l) => l.startsWith('package/templates/'))
    if (templateFiles.length === 0) {
        throw new Error('preset-nuxt4 tarball has no package/templates/* entries')
    }
    log(`preset-nuxt4 tarball contains ${templateFiles.length} template files`)
}

// --- 3. install ONLY the tarballs into a fresh consumer project -------------
// Every package is a direct dependency (not just `battlestack`) so the
// package manager satisfies internal `@battlestack/*` deps (rewritten from
// `workspace:*` to real versions by `pnpm pack`) from these exact tarballs,
// not from a registry — proving the workspace:* rewrite is real and correct.
// A direct `file:` dependency on every package is not sufficient by itself:
// **pnpm and bun** resolve `@battlestack/cli`'s own `@battlestack/tui: "0.1.0"`
// dependency (rewritten from `workspace:*` at pack time) against the
// registry, not against a same-named sibling `file:` dependency declared at
// the consumer's top level — measured, not assumed (a bare direct-deps-only
// attempt 404s against the real npm registry for the scoped packages, which
// obviously aren't published there). npm 11 does NOT behave this way: it
// satisfies the transitive reference from the top-level `file:` dep, so a
// direct-deps-only consumer would install fine under npm and prove less than
// it looks like it proves. The override below is what makes this check
// equally strict on every package manager. `pnpm.overrides` forces every
// transitive reference to these package names onto the local tarballs
// instead, which is what actually proves the workspace:* rewrite + install
// graph resolves correctly end to end.
const fileDeps = Object.fromEntries(PACKAGES.map((p) => [p.name, `file:${tarballs[p.name]}`]))
const consumerPkg = {
    name: 'battlestack-pack-smoke-consumer',
    private: true,
    version: '0.0.0',
    type: 'module',
    dependencies: fileDeps,
}
writeFileSync(path.join(consumerDir, 'package.json'), JSON.stringify(consumerPkg, null, 2))
// Isolate from the monorepo's own pnpm-workspace.yaml / lockfile — this must
// resolve as a standalone install, not get folded back into the workspace
// graph above it. `overrides` moved out of package.json#pnpm into
// pnpm-workspace.yaml as of pnpm 10 — needed so the wrapper's own
// `@battlestack/cli` dep and the CLI's `@battlestack/tui`/`@battlestack/core`
// deps (rewritten from `workspace:*` to plain semver by `pnpm pack`) resolve
// to these local tarballs instead of the real npm registry.
writeFileSync(
    path.join(consumerDir, 'pnpm-workspace.yaml'),
    `packages: []\noverrides:\n${
        Object.entries(fileDeps).map(([name, spec]) => `  '${name}': '${spec}'`).join('\n')
    }\n`,
)

log('installing tarballs into fresh consumer project...')
run('pnpm', ['install', '--no-frozen-lockfile'], { cwd: consumerDir })

// --- 4. run the installed binary --------------------------------------------
const binDir = path.join(consumerDir, 'node_modules', '.bin')
const bin = path.join(binDir, 'battlestack')
if (!existsSync(bin)) {
    throw new Error(`installed binary not found at ${bin}. node_modules/.bin: ${
        existsSync(binDir) ? readdirSync(binDir).join(', ') : '(missing)'
    }`)
}

log('running `battlestack --version`...')
const version = run(bin, ['--version'], { cwd: consumerDir }).trim()
log(`  -> ${version}`)
if (!/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(`--version did not print a semver: ${JSON.stringify(version)}`)
}

log('running `battlestack --help`...')
const help = run(bin, ['--help'], { cwd: consumerDir })
if (!help.trim()) {
    throw new Error('--help printed nothing')
}
log(`  -> ${help.split('\n').length} lines of help output`)

rmSync(work, { recursive: true, force: true })
log('OK — installed tarballs run the CLI and ship templates.')
