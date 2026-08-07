/**
 * The npm and bun legs of the publish path, which have never run.
 *
 * `scripts/pack-smoke.mjs` proves the tarball install works under **pnpm** —
 * hardcoded, all three call sites. STATUS.md claimed the publish path was
 * "verified by real tarball install → scaffold → `nuxt build`, on npm, pnpm and
 * bun independently"; an audit of every script, package.json script block and
 * workflow found no automation for the npm or bun legs and none for `nuxt build`
 * anywhere. This script is the missing legs.
 *
 * Deliberately a sibling of `pack-smoke.mjs` rather than a rewrite of it: that
 * script is a closed, passing gate and this one is new and slower (it can
 * install and build a real Nuxt app). Breaking the working pnpm gate to
 * generalise it would trade a known-good check for an unknown one.
 *
 * ---------------------------------------------------------------------------
 * The interesting part is NOT "does npm install a tarball". It's transitive
 * resolution of the scoped packages.
 *
 * `pnpm pack` rewrites `workspace:*` deps to real semver, so the packed
 * `battlestack` tarball depends on `@battlestack/core: "0.1.0"` — a version
 * that does not exist on the public registry. Declaring every package as a
 * top-level `file:` dependency is NOT enough: a package manager resolves
 * `battlestack`'s OWN dependency against the registry, not against a
 * same-named sibling `file:` entry in the consumer's manifest. It 404s.
 *
 * Each package manager needs a different override mechanism to redirect those
 * transitive references at the local tarballs, and that difference is the thing
 * that has never been exercised:
 *   - pnpm 10+  → `overrides:` in pnpm-workspace.yaml (what pack-smoke.mjs does)
 *   - npm       → `overrides` in package.json
 *   - bun       → `overrides` in package.json (npm-compatible)
 *
 * MEASURED, not assumed — the override wiring was removed and each leg re-run:
 *   - bun  FAILS without it (`bun install` errors outright). Load-bearing.
 *   - npm  SUCCEEDS without it, on npm 11.17.0: it satisfies the transitive
 *          `@battlestack/core: "0.1.0"` range from the top-level `file:`
 *          dependency, and the installed binary imports and runs correctly.
 *
 * That second result contradicts `pack-smoke.mjs`'s comment, which says
 * "pnpm/npm/yarn resolve `battlestack`'s own OWN `@battlestack/tui` dependency
 * against the registry, not against a same-named sibling `file:` dependency …
 * confirmed empirically". True for pnpm and bun; NOT true for npm 11.
 *
 * The npm `overrides` are kept anyway, deliberately: they cost nothing, they
 * pin the resolution explicitly instead of relying on npm's hoisting staying
 * this way across majors, and a future npm that tightened this would otherwise
 * turn a green leg red for a reason that has nothing to do with our packaging.
 * But do not mistake them for load-bearing — only bun's are.
 * ---------------------------------------------------------------------------
 *
 * Usage (assumes `pnpm build` has run — the root `pack:smoke:matrix` chains it):
 *   node scripts/pack-smoke-matrix.mjs                 # npm + bun, install legs
 *   node scripts/pack-smoke-matrix.mjs --pm npm        # one leg
 *   node scripts/pack-smoke-matrix.mjs --scaffold      # + real scaffold & nuxt build
 *
 * `--scaffold` is opt-in because it installs a full Nuxt app per leg and runs a
 * production build: minutes, not seconds, and it needs network.
 *
 * Exits non-zero listing every leg that failed. One leg failing never stops the
 * others — the point is knowing WHICH package managers work.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const PACKAGES = [
    { dir: 'packages/core', name: '@battlestack/core' },
    { dir: 'packages/tui', name: '@battlestack/tui' },
    { dir: 'packages/preset-nuxt4', name: '@battlestack/preset-nuxt4' },
    { dir: 'packages/cli', name: 'battlestack' },
]

/** The template both this and task #21's pnpm leg use, so results are comparable. */
const TEMPLATE = 'nuxt4-minimal'

const argv = process.argv.slice(2)
const pmFlag = argv.indexOf('--pm')
const REQUESTED = pmFlag !== -1 ? (argv[pmFlag + 1] ?? '').split(',').filter(Boolean) : ['npm', 'bun']
const DO_SCAFFOLD = argv.includes('--scaffold')

const failures = []
const log = (m) => console.log(`[matrix] ${m}`)

function run(cmd, args, opts = {}) {
    return execFileSync(cmd, args, {
        encoding: 'utf8',
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...opts,
    })
}

/** Package-manager-specific install invocation and override wiring. */
const MANAGERS = {
    npm: {
        install: ['install', '--no-audit', '--no-fund'],
        // npm honours top-level `overrides` for transitive deps.
        wire: (pkg, fileDeps) => { pkg.overrides = { ...fileDeps } },
    },
    bun: {
        install: ['install'],
        // bun reads npm-style `overrides`.
        wire: (pkg, fileDeps) => { pkg.overrides = { ...fileDeps } },
    },
    pnpm: {
        install: ['install', '--no-frozen-lockfile'],
        // pnpm 10 moved overrides out of package.json into the workspace file.
        wire: (_pkg, fileDeps, consumerDir) => {
            writeFileSync(
                path.join(consumerDir, 'pnpm-workspace.yaml'),
                `packages: []\noverrides:\n${
                    Object.entries(fileDeps).map(([n, s]) => `  '${n}': '${s}'`).join('\n')
                }\n`,
            )
        },
    },
}

for (const pm of REQUESTED) {
    if (!MANAGERS[pm]) {
        failures.push(`unknown package manager "${pm}"`)
        continue
    }
    if (!hasBinary(pm)) {
        failures.push(`${pm}: not installed on this machine — leg not run (this is a gap, not a pass)`)
        continue
    }
}

const work = mkdtempSync(path.join(tmpdir(), 'battlestack-matrix-'))
log(`work dir: ${work}`)

// --- pack once; `pnpm pack` is the publish-equivalent packer for all legs ----
const tarballDir = path.join(work, 'tarballs')
mkdirSync(tarballDir, { recursive: true })
const tarballs = {}
for (const pkg of PACKAGES) {
    const out = run('pnpm', ['pack', '--pack-destination', tarballDir], {
        cwd: path.join(root, pkg.dir),
    })
    const line = out.trim().split('\n').at(-1).trim()
    if (!existsSync(line)) throw new Error(`pnpm pack for ${pkg.name} reported no tarball: ${out}`)
    tarballs[pkg.name] = line
}
log(`packed ${Object.keys(tarballs).length} tarballs`)

for (const pm of REQUESTED) {
    if (!MANAGERS[pm] || !hasBinary(pm)) continue
    try {
        leg(pm)
    } catch (err) {
        failures.push(`${pm}: ${err.message.split('\n')[0]}`)
        log(`${pm}: FAILED — ${err.message.split('\n')[0]}`)
    }
}

rmSync(work, { recursive: true, force: true })

if (failures.length > 0) {
    console.error(`\n[matrix] FAILED\n${failures.map((f) => `  - ${f}`).join('\n')}`)
    process.exit(1)
}
log(`OK — ${REQUESTED.join(' + ')} install${DO_SCAFFOLD ? ' + scaffold + nuxt build' : ''} verified.`)

function hasBinary(bin) {
    try {
        execFileSync(bin, ['--version'], { stdio: 'ignore' })
        return true
    } catch {
        return false
    }
}

function leg(pm) {
    log(`--- ${pm} leg ---`)
    const mgr = MANAGERS[pm]
    const consumerDir = path.join(work, `consumer-${pm}`)
    mkdirSync(consumerDir, { recursive: true })

    const fileDeps = Object.fromEntries(PACKAGES.map((p) => [p.name, `file:${tarballs[p.name]}`]))
    const pkg = {
        name: `battlestack-matrix-consumer-${pm}`,
        private: true,
        version: '0.0.0',
        type: 'module',
        dependencies: { ...fileDeps },
    }
    mgr.wire(pkg, fileDeps, consumerDir)
    writeFileSync(path.join(consumerDir, 'package.json'), JSON.stringify(pkg, null, 2))

    log(`${pm}: installing tarballs...`)
    run(pm, mgr.install, { cwd: consumerDir });

    // The binary must exist AND execute. `--version` printing a semver proves
    // the shebang, the bin mapping and every transitive @battlestack/* import
    // resolved — which is the whole point of the override wiring above.
    {
        const bin = path.join(consumerDir, 'node_modules', '.bin', 'battlestack')
        if (!existsSync(bin)) {
            const binDir = path.dirname(bin)
            throw new Error(`installed binary missing at ${bin}; .bin has: ${
                existsSync(binDir) ? readdirSync(binDir).join(', ') : '(no .bin dir)'
            }`)
        }
        const version = run(bin, ['--version'], { cwd: consumerDir }).trim()
        if (!/^\d+\.\d+\.\d+/.test(version)) {
            throw new Error(`--version did not print a semver: ${JSON.stringify(version)}`)
        }
        log(`${pm}: binary runs, version ${version}`)
        if (!run(bin, ['--help'], { cwd: consumerDir }).trim()) {
            throw new Error('--help printed nothing')
        }
    }

    if (!DO_SCAFFOLD) return

    // --- the half nothing has ever automated: scaffold, then really build ----
    const appName = `matrix-${pm}-app`
    const appParent = path.join(work, `scaffold-${pm}`)
    mkdirSync(appParent, { recursive: true })
    const bin = path.join(consumerDir, 'node_modules', '.bin', 'battlestack')

    log(`${pm}: scaffolding ${TEMPLATE} with --pm ${pm} (installs a real Nuxt app)...`)
    run(bin, [appName, TEMPLATE, '--pm', pm, '--yes'], {
        cwd: appParent,
        // Scaffold shells out to the package manager and fetches skills; give it
        // room and a clean env so it can't inherit the monorepo's pnpm context.
        timeout: 20 * 60_000,
        env: { ...process.env, CI: '1' },
    })

    const appDir = path.join(appParent, appName)
    if (!existsSync(path.join(appDir, 'package.json'))) {
        throw new Error(`scaffold produced no package.json at ${appDir}`)
    }

    log(`${pm}: running nuxt build...`)
    // Via the project's own script, so this exercises what a user actually runs
    // (and, for bun/npm, that the emitted scripts are runnable by that PM).
    run(pm, ['run', 'build'], { cwd: appDir, timeout: 20 * 60_000, env: { ...process.env, CI: '1' } })

    // A build that "succeeded" without emitting a server bundle is not a build.
    const output = path.join(appDir, '.output', 'server', 'index.mjs')
    if (!existsSync(output)) {
        throw new Error(`nuxt build exited 0 but produced no ${path.relative(appDir, output)}`)
    }
    log(`${pm}: nuxt build produced .output/server/index.mjs`)
}
