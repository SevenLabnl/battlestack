import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { ui } from '@battlestack/tui'
import {
    CLIError,
    ErrorCode,
    detectFromUserAgent,
    run,
    spawnSyncResolved as safeSpawnSync,
    type GatedTarget,
    type PackageManager,
    type SelfUpdateOptions,
    type UpdateDecision,
} from '@battlestack/core'

// Unscoped public package name (the `packages/battlestack` wrapper — what users
// globally install), used by npm view, `<pm> add -g` and the bun regex. The
// wrapper is published in version lockstep with @battlestack/cli, so comparing
// its registry version against our own package.json version stays valid.
const PACKAGE_NAME = 'battlestack'

export async function selfUpdateCommand(options: SelfUpdateOptions = {}): Promise<void> {
    const currentVersion = await readCurrentVersion()
    const installLocation = detectInstallLocation()
    const tag = options.tag ?? 'latest'

    const detectedPM = installLocation.kind === 'global' ? installLocation.pm : null
    const pm = options.packageManager ?? detectedPM ?? pickDefaultPM()

    // What the dist-tag points at.
    const trueLatest = resolveRegistryVersion(tag)
    // What pnpm's minimum-release-age gate allows today. For npm/bun, or --force, the true latest.
    const gated = !options.force && !options.tag && pm === 'pnpm' && trueLatest
        ? resolveGatedTarget(trueLatest)
        : null

    const decision = decideUpdate({
        currentVersion,
        trueLatest,
        gated,
        force: Boolean(options.force),
        explicitTag: options.tag ?? null,
    })

    ui.section('Self-update')
    ui.kv([
        ['package', PACKAGE_NAME],
        ['current', currentVersion],
        ['target', decision.targetVersion ? `${tag} (${decision.targetVersion})` : tag],
    ])

    if (installLocation.kind === 'dlx') {
        ui.warn(
            'CLI is running via a one-shot runner (pnpm dlx / npx / bunx). '
            + 'There is nothing persistent to update; install globally first:',
        )
        ui.bullet(`pnpm add -g ${PACKAGE_NAME}@latest`)
        ui.bullet(`npm i -g ${PACKAGE_NAME}@latest`)
        ui.bullet(`bun i -g ${PACKAGE_NAME}@latest`)
        return
    }

    if (decision.action === 'skip') {
        ui.ok(`You're on ${currentVersion}, nothing to update right now`)
        if (decision.heldBack && trueLatest && gated) notifyHeldBack(trueLatest, gated)
        return
    }

    // Pinned to the resolved version. --force also disables the release-age gate for this install.
    const spec = `${PACKAGE_NAME}@${decision.targetVersion ?? tag}`
    const installArgs = globalAddArgs(pm, spec, Boolean(options.force))

    ui.step(`Upgrading via ${pm}...`)
    try {
        const env = pm === 'pnpm' ? pnpmPathEnv() : undefined
        await run(pm, installArgs, { inherit: true, env })
    } catch (error) {
        throw new CLIError(
            ErrorCode.EXEC_FAILED,
            `Self-update failed via ${pm}. Try running manually: \`${pm} ${installArgs.join(' ')}\``,
            error,
        )
    }

    const newVersion = await readInstalledVersion(pm)
    if (newVersion && currentVersion !== 'unknown' && !options.force && !options.tag
        && semverLt(newVersion, currentVersion)) {
        ui.warn(
            `Package manager installed ${newVersion}, older than the previous ${currentVersion}. `
            + `Restore with: \`${pm} ${globalAddArgs(pm, `${PACKAGE_NAME}@${currentVersion}`, true).join(' ')}\``,
        )
        return
    }
    ui.ok(
        newVersion && newVersion !== currentVersion
            ? `Updated ${currentVersion} → ${newVersion}`
            : 'Update finished',
    )
    // The newest allowed version was taken; a newer one may still be inside the window.
    if (decision.heldBack && trueLatest && gated) notifyHeldBack(trueLatest, gated)
}

/**
 * Targets what the gate allows, else the true latest. Never downgrades or reinstalls the
 * same version. `--force` and an explicit `--tag` bypass both rules.
 */
export function decideUpdate(input: {
    currentVersion: string
    trueLatest: string | null
    gated: GatedTarget | null
    force: boolean
    explicitTag: string | null
}): UpdateDecision {
    const { currentVersion, trueLatest, gated, force, explicitTag } = input
    const targetVersion = gated ? gated.version : trueLatest
    const currentKnown = currentVersion !== 'unknown'

    if (!force && currentKnown) {
        // Every release is too young to pass the gate.
        if (gated && !targetVersion) {
            return {
                action: 'skip',
                targetVersion: null,
                heldBack: Boolean(trueLatest && semverLt(currentVersion, trueLatest)),
            }
        }
        if (targetVersion) {
            const upToDate = targetVersion === currentVersion
            // The gate can make `latest` resolve behind the installed version. Never downgrade.
            const wouldDowngrade = !explicitTag && semverLt(targetVersion, currentVersion)
            if (upToDate || wouldDowngrade) {
                return {
                    action: 'skip',
                    targetVersion,
                    heldBack: Boolean(gated && trueLatest && semverLt(currentVersion, trueLatest)),
                }
            }
        }
    }

    return {
        action: 'install',
        targetVersion,
        heldBack: Boolean(gated && trueLatest && targetVersion && semverLt(targetVersion, trueLatest)),
    }
}

/** Reports a newer release held back by the release-age window, and how to opt out. */
function notifyHeldBack(version: string, gated: GatedTarget): void {
    ui.warn(
        `${version} is available, but pnpm holds new releases back for `
        + `${formatWindow(gated.gateMinutes)} as protection against compromised packages`
        + `${gated.unlocksAt ? ` (it unlocks ${gated.unlocksAt})` : ''}`,
    )
    ui.bullet('run `battlestack self-update --force` to skip the safety window and install it now')
}

/** Human-readable gate window: "24 hours", "90 minutes". */
export function formatWindow(minutes: number): string {
    if (minutes % 60 === 0) {
        const hours = minutes / 60
        return hours === 1 ? '1 hour' : `${hours} hours`
    }
    return `${minutes} minutes`
}

/** Newest stable version at least `gateMinutes` old, plus when `trueLatest` clears the gate. */
function resolveGatedTarget(trueLatest: string): GatedTarget | null {
    const times = fetchPublishTimes()
    if (!times) return null
    return computeGatedTarget(trueLatest, times, pnpmGateMinutes(), Date.now())
}

/** {@link resolveGatedTarget} with all inputs injected. */
export function computeGatedTarget(
    trueLatest: string,
    times: Record<string, string>,
    gateMinutes: number,
    now: number,
): GatedTarget {
    const cutoff = now - gateMinutes * 60_000
    let newest: string | null = null
    for (const [version, published] of Object.entries(times)) {
        if (!/^\d+\.\d+\.\d+$/.test(version)) continue // skip created/modified/prereleases
        if (new Date(published).getTime() > cutoff) continue
        if (!newest || semverLt(newest, version)) newest = version
    }

    const latestPublished = times[trueLatest]
    const unlocksAt = latestPublished
        ? new Date(new Date(latestPublished).getTime() + gateMinutes * 60_000)
                .toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
        : null

    return { version: newest, gateMinutes, unlocksAt }
}

/** Effective minimum-release-age in minutes. Unset means pnpm 11's built-in 1440. */
function pnpmGateMinutes(): number {
    const get = (key: string): string => {
        const r = safeSpawnSync('pnpm', ['config', 'get', key], { encoding: 'utf8', timeout: 5000 })
        return r.status === 0 ? (r.stdout ?? '').trim() : ''
    }

    const exclude = get('minimum-release-age-exclude')
    if (exclude.includes(PACKAGE_NAME)) return 0

    const raw = get('minimum-release-age')
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed) && parsed >= 0) return parsed

    const versionOut = safeSpawnSync('pnpm', ['--version'], { encoding: 'utf8', timeout: 5000 })
    const pnpmMajor = Number.parseInt((versionOut.stdout ?? '').trim(), 10)
    return pnpmMajor >= 11 ? 1440 : 0
}

/** Publish timestamps per version from the registry, or null when unreachable. */
function fetchPublishTimes(): Record<string, string> | null {
    const r = safeSpawnSync('npm', ['view', PACKAGE_NAME, 'time', '--json'], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (r.status !== 0 || !r.stdout) return null
    try {
        const parsed = JSON.parse(r.stdout) as unknown
        return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : null
    } catch {
        return null
    }
}

/** What a dist-tag or range points at, via `npm view`. Null when offline. */
function resolveRegistryVersion(tag: string): string | null {
    const r = safeSpawnSync('npm', ['view', `${PACKAGE_NAME}@${tag}`, 'version'], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (r.status !== 0 || !r.stdout) return null
    // A range can match multiple versions. The last line is the highest.
    const lines = r.stdout.trim().split('\n').filter(Boolean)
    const last = lines[lines.length - 1] ?? ''
    const match = /(\d+\.\d+\.\d+(?:-[\w.]+)?)\s*$/.exec(last.replace(/['"]/g, ''))
    return match?.[1] ?? null
}

/** True if semver `a` is strictly older than `b` (major.minor.patch). */
export function semverLt(a: string, b: string): boolean {
    const pa = (a.split('-')[0] ?? '').split('.').map((n) => Number.parseInt(n, 10) || 0)
    const pb = (b.split('-')[0] ?? '').split('.').map((n) => Number.parseInt(n, 10) || 0)
    for (let i = 0; i < 3; i++) {
        const x = pa[i] ?? 0
        const y = pb[i] ?? 0
        if (x !== y) return x < y
    }
    return false
}

/** Resolves pnpm's global bin dir and prepends it to PATH. Config wins over `$PNPM_HOME/bin`. */
function pnpmPathEnv(): Record<string, string> | undefined {
    const candidates: Array<() => string | null> = [
        () => {
            const r = safeSpawnSync('pnpm', ['config', 'get', 'global-bin-dir'], { encoding: 'utf8' })
            const out = r.status === 0 ? (r.stdout ?? '').trim() : ''
            return out && out !== 'undefined' && out !== 'null' ? out : null
        },
        () => {
            const home = process.env.PNPM_HOME
            if (!home) return null
            const withBin = path.join(home, 'bin')
            return existsSync(withBin) ? withBin : home
        },
        () => {
            const lookup = process.platform === 'win32' ? 'where' : 'which'
            const r = safeSpawnSync(lookup, ['pnpm'], { encoding: 'utf8' })
            const bin = r.status === 0 ? (r.stdout ?? '').trim().split(/\r?\n/)[0] : ''
            return bin ? path.dirname(bin) : null
        },
    ]

    let dir: string | null = null
    for (const resolve of candidates) {
        dir = resolve()
        if (dir) break
    }
    if (!dir) return undefined
    const current = process.env.PATH ?? ''
    if (current.split(path.delimiter).includes(dir)) return undefined
    return { PATH: `${dir}${path.delimiter}${current}` }
}

function globalAddArgs(pm: PackageManager, spec: string, bypassGate = false): string[] {
    switch (pm) {
        case 'pnpm':
            // Flag form only: pnpm ignores the env-var form.
            return bypassGate
                ? ['add', '-g', spec, '--config.minimum-release-age=0']
                : ['add', '-g', spec]
        case 'bun':
            return ['add', '-g', spec]
        case 'npm':
            return ['install', '-g', spec]
    }
}

type InstallLocation
    = | { kind: 'global', pm: PackageManager | null }
        | { kind: 'dlx' }
        | { kind: 'unknown' }

/** Persistent global install vs one-shot dlx cache. */
function detectInstallLocation(): InstallLocation {
    const entry = fileURLToPath(import.meta.url)
    const lower = entry.toLowerCase()

    const dlxMarkers = ['/dlx-', '/_npx/', '/.npm/_npx/', '/bun/install/cache/', '/.bun/install/cache/']
    if (dlxMarkers.some((m) => lower.includes(m))) return { kind: 'dlx' }

    const pmMarkers: Array<[string, PackageManager]> = [
        ['/pnpm/global/', 'pnpm'],
        ['/pnpm-global/', 'pnpm'],
        ['/.local/share/pnpm/', 'pnpm'],
        ['/library/pnpm/', 'pnpm'],
        ['/.bun/install/global/', 'bun'],
        ['/lib/node_modules/', 'npm'],
    ]
    for (const [marker, pm] of pmMarkers) {
        if (lower.includes(marker)) return { kind: 'global', pm }
    }

    return { kind: 'unknown' }
}

function pickDefaultPM(): PackageManager {
    const fromUA = detectFromUserAgent()
    if (fromUA) return fromUA
    for (const pm of ['pnpm', 'npm', 'bun'] as PackageManager[]) {
        if (safeSpawnSync(pm, ['--version'], { stdio: 'ignore' }).status === 0) return pm
    }
    return 'npm'
}

async function readCurrentVersion(): Promise<string> {
    try {
        const here = path.dirname(fileURLToPath(import.meta.url))
        const pkgPath = path.resolve(here, '..', '..', 'package.json')
        const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { version?: string }
        return pkg.version ?? 'unknown'
    } catch {
        return 'unknown'
    }
}

function listGlobalArgs(pm: PackageManager): string[] {
    switch (pm) {
        case 'pnpm':
            return ['list', '-g', '--depth=0', '--json', PACKAGE_NAME]
        case 'npm':
            return ['ls', '-g', '--depth=0', '--json', PACKAGE_NAME]
        case 'bun':
            return ['pm', 'ls', '-g']
    }
}

async function readInstalledVersion(pm: PackageManager): Promise<string | null> {
    const r = safeSpawnSync(pm, listGlobalArgs(pm), { encoding: 'utf8' })
    if (r.status !== 0 || !r.stdout) return null
    return parseInstalledVersion(pm, r.stdout)
}

/** Our installed version, from a PM's global-list output. */
export function parseInstalledVersion(pm: PackageManager, stdout: string): string | null {
    // `bun pm ls -g` prints "name@version" lines, not JSON.
    if (pm === 'bun') {
        const match = new RegExp(`${PACKAGE_NAME}[@\\s:"]+([\\d.]+(?:-[\\w.]+)?)`).exec(stdout)
        return match?.[1] ?? null
    }

    // npm prints one project object, pnpm an array. Both hold dependencies[PACKAGE_NAME].version.
    try {
        const parsed = JSON.parse(stdout) as unknown
        const projects = Array.isArray(parsed) ? parsed : [parsed]
        for (const project of projects) {
            const dep = (project as { dependencies?: Record<string, { version?: string }> })
                .dependencies?.[PACKAGE_NAME]
            if (dep?.version) return dep.version
        }
    } catch {
        // Unparseable output counts as unknown.
    }
    return null
}
