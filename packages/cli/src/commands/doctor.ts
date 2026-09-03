import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pc from 'picocolors'
import type { Ora } from 'ora'
import { ui } from '@battlestack/tui'
import {
    buildRunContext,
    classifyFileState,
    CLIError,
    enabledHas,
    ErrorCode,
    exists,
    findProjectRoot,
    isPortFree,
    PNPM_PIN,
    readManifest,
    spawnSyncResolved as safeSpawnSync,
    STAGE_ORDER,
    SUPPORTED_PMS,
    type BattlestackRegistries,
    type ParsedArgs,
    type ProjectManifest,
    type ReservedCommand,
} from '@battlestack/core'
import { pmChecks, pnpmVersionChecks } from '@battlestack/core/utils/preflight.js'

/** Static metadata only. `run` is built per-dispatch in `project.ts`. */
export const doctorReservedMeta: Omit<ReservedCommand, 'run'> = {
    name: 'doctor',
    usage: 'battlestack doctor',
    label: 'diagnose drift / stale features (read-only)',
    group: 'Discovery',
}

interface PreflightCheck {
    label: string
    state: 'ok' | 'warn' | 'fail'
    detail?: string
}

interface FileStatus {
    rel: string
    state: 'pristine' | 'drifted' | 'missing' | 'owned' | 'unknown'
}

interface FeatureReport {
    id: string
    installedVersion: string
    availableVersion: string | null
    status: 'up-to-date' | 'stale' | 'unknown' | 'orphaned' | 'install-only'
    files: FileStatus[]
}

/** Read-only per-feature version and tracked-file hash report. */
export async function doctorCommand(args: ParsedArgs, _loader: Ora, registries: BattlestackRegistries): Promise<void> {
    const projectRoot = await findProjectRoot(process.cwd())
    if (!projectRoot) {
        // Outside a project, the CLI install and environment are checked instead.
        await cliDoctor()
        return
    }

    const manifest = await readManifest(projectRoot, registries)
    if (!manifest) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            `No manifest at ${projectRoot}/.battlestack/manifest.json`,
        )
    }

    const preflight = await runPreflight(projectRoot, manifest, registries)
    const dockerignore = await dockerignoreCheck(projectRoot, manifest, registries)
    if (dockerignore) preflight.push(dockerignore)
    const orphanedPlugin = orphanedPluginCheck(manifest, registries)
    if (orphanedPlugin) preflight.push(orphanedPlugin)

    const sortedFeatures = [...manifest.features].sort((a, b) => {
        const fa = registries.features.has(a.id) ? registries.features.get(a.id) : null
        const fb = registries.features.has(b.id) ? registries.features.get(b.id) : null
        const sa = fa ? STAGE_ORDER.indexOf(fa.stage) : Number.MAX_SAFE_INTEGER
        const sb = fb ? STAGE_ORDER.indexOf(fb.stage) : Number.MAX_SAFE_INTEGER
        if (sa !== sb) return sa - sb
        return a.id.localeCompare(b.id)
    })

    const reports: FeatureReport[] = []
    for (const record of sortedFeatures) {
        const installed = record.version
        let available: string | null = null
        let status: FeatureReport['status'] = 'orphaned'

        if (registries.features.has(record.id)) {
            const feature = registries.features.get(record.id)
            available = feature.version
            if (feature.upgradable === false) {
                status = 'install-only'
            } else {
                status = available === installed ? 'up-to-date' : 'stale'
            }
        }

        const ownedSet = new Set(record.ownedByUser ?? [])
        const files: FileStatus[] = []
        for (const [rel, recordedHash] of Object.entries(record.files ?? {})) {
            const abs = path.join(projectRoot, rel)
            const state = await classifyFileState(abs, recordedHash, ownedSet.has(rel))
            files.push({ rel, state })
        }

        reports.push({ id: record.id, installedVersion: installed, availableVersion: available, status, files })
    }

    printPreflight(preflight)
    print(reports, manifest.template, args.debug, args.deep)
}

/** Reports manifest entries whose namespace no loaded plugin provides. */
function orphanedPluginCheck(
    manifest: ProjectManifest,
    registries: BattlestackRegistries,
): PreflightCheck | null {
    const loadedNamespaces = new Set(
        registries.features.all().map((feature) => feature.fqid.split(':')[0]),
    )
    const referencedIds = [
        ...manifest.features.map((record) => record.id),
        ...(manifest.optedOut ?? []),
    ]

    const orphanedNamespaces = new Set<string>()
    for (const id of referencedIds) {
        const segments = id.split(':')
        if (segments.length < 3) continue
        const namespace = segments[0]!
        if (!loadedNamespaces.has(namespace)) orphanedNamespaces.add(namespace)
    }
    if (orphanedNamespaces.size === 0) return null

    const names = [...orphanedNamespaces].sort().join(', ')
    return {
        label: 'plugin state',
        state: 'warn',
        detail: `features from ${names} are recorded but no loaded plugin provides them; their files are still on disk and untracked. Reinstall the plugin, run \`battlestack remove\` for each of its features, then remove the plugin`,
    }
}

/** Reports a missing `.dockerignore` in a project that builds a Docker image. */
async function dockerignoreCheck(
    projectRoot: string,
    manifest: ProjectManifest,
    registries: BattlestackRegistries,
): Promise<PreflightCheck | null> {
    const hasDocker = manifest.features.some(
        (record) =>
            registries.features.has(record.id)
            && registries.features.get(record.id).id === 'shared:docker',
    )
    if (!hasDocker) return null

    const present = await exists(path.join(projectRoot, '.dockerignore'))
    return {
        label: '.dockerignore present',
        state: present ? 'ok' : 'warn',
        detail: present
            ? undefined
            : 'the Docker build copies the whole project; without it the image gets node_modules, .output and .env',
    }
}

/** Diagnoses the CLI install and host environment rather than project drift. */
async function cliDoctor(): Promise<void> {
    ui.section('Battlestack CLI doctor')
    ui.warn('Not inside a battlestack project (no .battlestack/manifest.json found)')
    ui.dim('Diagnosing the battlestack CLI install + host environment instead.')
    ui.blank()

    const checks: PreflightCheck[] = []

    const nodeMajor = Number(process.versions.node.split('.')[0])
    checks.push({
        label: 'Node ≥ 24',
        state: nodeMajor >= 24 ? 'ok' : 'fail',
        detail: `current: ${process.version}`,
    })

    checks.push(cliVersionCheck())

    const pmVersions = new Map<string, string>()
    for (const pm of SUPPORTED_PMS) {
        const probe = safeSpawnSync(pm, ['--version'], { encoding: 'utf8', timeout: 5000 })
        if (probe.status === 0) pmVersions.set(pm, (probe.stdout ?? '').trim())
    }
    const anyPm = [...pmVersions.keys()]
    checks.push({
        label: 'package manager on PATH',
        state: anyPm.length > 0 ? 'ok' : 'fail',
        detail: anyPm.length > 0
            ? `found: ${anyPm.join(', ')}${anyPm.includes('pnpm') ? '' : '; pnpm is the default, scaffold with --pm ' + anyPm[0] + ' or run `npm i -g ' + PNPM_PIN + '`'}`
            : `none of ${SUPPORTED_PMS.join('/')} found on PATH`,
    })

    const pnpmVersion = pmVersions.get('pnpm')
    if (pnpmVersion !== undefined) checks.push(...pnpmVersionChecks(pnpmVersion))

    const git = safeSpawnSync('git', ['--version'], { stdio: 'ignore' })
    checks.push({
        label: 'git on PATH',
        state: git.status === 0 ? 'ok' : 'warn',
        detail: git.status === 0 ? undefined : '`git` not found on PATH',
    })

    const docker = safeSpawnSync('docker', ['--version'], { stdio: 'ignore' })
    checks.push({
        label: 'docker on PATH',
        state: docker.status === 0 ? 'ok' : 'warn',
        detail: docker.status === 0 ? undefined : 'optional: needed for `battlestack up` / database projects',
    })

    printPreflight(checks)
    ui.blank()
    ui.dim('Run `battlestack doctor` inside a project for the full feature / drift report.')
    ui.blank()
}

/** The CLI's own version, from its package.json. */
function cliVersionCheck(): PreflightCheck {
    try {
        const here = path.dirname(fileURLToPath(import.meta.url))
        const pkg = JSON.parse(
            readFileSync(path.resolve(here, '..', '..', 'package.json'), 'utf8'),
        ) as { version?: string }
        return { label: 'battlestack CLI version', state: 'ok', detail: pkg.version ?? 'unknown' }
    } catch {
        return { label: 'battlestack CLI version', state: 'warn', detail: 'could not read package.json' }
    }
}

/** Environment readiness checks. Diagnostic only: a failure does not abort. */
async function runPreflight(
    projectRoot: string,
    manifest: ProjectManifest,
    registries: BattlestackRegistries,
): Promise<PreflightCheck[]> {
    const out: PreflightCheck[] = []

    const nodeMajor = Number(process.versions.node.split('.')[0])
    out.push({
        label: 'Node ≥ 24',
        state: nodeMajor >= 24 ? 'ok' : 'fail',
        detail: `current: ${process.version}`,
    })

    const pm = manifest.packageManager
    out.push(...pmChecks(pm, {
        notFoundDetail: `\`${pm}\` not found: install it or change packageManager in manifest`,
        belowMinState: 'warn',
    }))

    const enabled = new Set(manifest.features.map((f) => f.id))

    if (enabledHas(enabled, 'nuxt4:database', registries)) {
        const dockerCli = safeSpawnSync('docker', ['--version'], { stdio: 'ignore' })
        if (dockerCli.status === 0) {
            const daemon = safeSpawnSync('docker', ['info'], { stdio: 'ignore' })
            out.push({
                label: 'Docker daemon',
                state: daemon.status === 0 ? 'ok' : 'fail',
                detail: daemon.status === 0 ? undefined : 'docker info failed: start Docker Desktop',
            })
        } else {
            out.push({
                label: 'Docker on PATH',
                state: 'fail',
                detail: 'Docker Desktop is required for nuxt4:database',
            })
        }
    }

    const portsToCheck = enabledHas(enabled, 'nuxt4:database', registries) ? [3000, 5432] : [3000]
    for (const port of portsToCheck) {
        const free = await isPortFree(port)
        out.push({
            label: `port ${port} free`,
            state: free ? 'ok' : 'warn',
            detail: free
                ? undefined
                : `something is already listening on ${port}; \`battlestack dev\` will fail (or use a fallback)`,
        })
    }

    const envPath = path.join(projectRoot, '.env')
    if (await exists(envPath)) {
        const required = collectRequiredEnvKeys(projectRoot, manifest, registries)
        const present = parseEnvKeys(await readFile(envPath, 'utf8'))
        const missing = [...required].filter((k) => !present.has(k))
        out.push({
            label: '.env has all required keys',
            state: missing.length === 0 ? 'ok' : 'warn',
            detail: missing.length === 0
                ? undefined
                : `missing: ${missing.join(', ')}; run \`battlestack install\` to append them (append-only, your values are preserved)`,
        })
    } else {
        out.push({
            label: '.env present',
            state: 'fail',
            detail: 'run `battlestack install` (regenerates from .env.example with fresh secrets)',
        })
    }

    return out
}

function collectRequiredEnvKeys(
    projectRoot: string,
    manifest: ProjectManifest,
    registries: BattlestackRegistries,
): Set<string> {
    const ctx = buildRunContext({ projectDir: projectRoot, manifest }, registries)
    const keys = new Set<string>()
    for (const id of ctx.enabledFeatures) {
        if (!registries.features.has(id)) continue
        const feature = registries.features.get(id)
        for (const v of feature.collectEnv?.(ctx) ?? []) keys.add(v.key)
    }
    return keys
}

function parseEnvKeys(content: string): Set<string> {
    const out = new Set<string>()
    for (const raw of content.split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line.startsWith('#')) continue
        const eq = line.indexOf('=')
        if (eq > 0) out.add(line.slice(0, eq).trim())
    }
    return out
}

function checkIcon(state: PreflightCheck['state']): string {
    if (state === 'ok') return ui.sym.ok
    if (state === 'warn') return ui.sym.warn
    return ui.sym.fail
}

function printPreflight(checks: PreflightCheck[]): void {
    ui.section('Preflight')
    for (const c of checks) {
        const icon = checkIcon(c.state)
        const detail = c.detail ? pc.dim(` (${c.detail})`) : ''
        console.log(`  ${icon} ${c.label}${detail}`)
    }
    const failed = checks.filter((c) => c.state === 'fail').length
    if (failed > 0) {
        ui.blank()
        ui.fail(`${failed} preflight check(s) failed; fix before running \`battlestack dev\``)
    }
}

function print(reports: FeatureReport[], templateId: string, debug: boolean, deep: boolean): void {
    ui.section('Features')
    ui.dim(`template: ${templateId}`)
    ui.blank()

    let staleCount = 0
    let driftedCount = 0
    let missingCount = 0
    let orphanCount = 0

    for (const r of reports) {
        const drifted = r.files.filter((f) => f.state === 'drifted').length
        const missing = r.files.filter((f) => f.state === 'missing').length
        const owned = r.files.filter((f) => f.state === 'owned').length
        const pristine = r.files.filter((f) => f.state === 'pristine').length
        driftedCount += drifted
        missingCount += missing
        if (r.status === 'stale') staleCount++
        if (r.status === 'orphaned') orphanCount++

        const tag = formatStatus(r.status, drifted, missing)
        const versionInfo
            = r.availableVersion && r.availableVersion !== r.installedVersion
                ? `${r.installedVersion} → ${r.availableVersion}`
                : r.installedVersion
        console.log(`  ${r.id.padEnd(26)} ${versionInfo.padEnd(20)} ${tag}`)

        if (deep) {
            console.log(
                pc.dim(
                    `      pristine ${pristine}  drifted ${drifted}  owned ${owned}  missing ${missing}`,
                ),
            )
            const buckets: { label: string, state: FileStatus['state'] }[] = [
                { label: 'pristine', state: 'pristine' },
                { label: 'drifted', state: 'drifted' },
                { label: 'owned', state: 'owned' },
                { label: 'missing', state: 'missing' },
            ]
            for (const { label, state } of buckets) {
                const items = r.files.filter((f) => f.state === state)
                if (items.length === 0) continue
                console.log(pc.dim(`      ${label}:`))
                for (const f of items) {
                    console.log(pc.dim(`        ${tagChar(f.state)} ${f.rel}`))
                }
            }
        } else if (debug || drifted > 0 || missing > 0) {
            for (const f of r.files) {
                if (f.state === 'pristine' && !debug) continue
                console.log(pc.dim(`      ${tagChar(f.state)} ${f.rel}`))
            }
        }
    }

    ui.blank()
    if (staleCount === 0 && driftedCount === 0 && missingCount === 0 && orphanCount === 0) {
        ui.ok('All features up to date, no drift, no missing files')
    } else {
        if (staleCount)
            ui.warn(`${staleCount} feature(s) stale; run \`battlestack pull\` (or \`battlestack sync\`)`)
        if (driftedCount)
            ui.warn(
                `${driftedCount} file(s) edited since install; \`battlestack pull\` will stage merge artefacts under .battlestack/pull/`,
            )
        if (missingCount)
            ui.fail(
                `${missingCount} tracked file(s) missing; re-add the feature or restore from git`,
            )
        if (orphanCount)
            ui.fail(
                `${orphanCount} feature(s) recorded in manifest but no longer in the CLI; manual cleanup needed`,
            )
    }
    ui.blank()
}

function formatStatus(status: FeatureReport['status'], drifted: number, missing: number): string {
    if (status === 'orphaned') return pc.red('orphaned')
    if (status === 'install-only') return pc.dim('install-only')
    if (status === 'stale') return pc.yellow('stale')
    if (missing > 0) return pc.red(`${missing} missing`)
    if (drifted > 0) return pc.yellow(`${drifted} drifted`)
    return pc.green('ok')
}

function tagChar(state: FileStatus['state']): string {
    if (state === 'pristine') return ui.sym.pristine
    if (state === 'drifted') return ui.sym.drift
    if (state === 'missing') return ui.sym.missing
    if (state === 'owned') return ui.sym.owned
    return '?'
}
