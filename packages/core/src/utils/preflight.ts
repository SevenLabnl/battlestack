import net from 'node:net'
import { CLIError, ErrorCode } from './errors.js'
import { PNPM_MIN, PNPM_PIN, PNPM_PIN_VERSION } from '../constants/package-manager.js'
import { getUiPort } from '../ui-port.js'
import { spawnSyncResolved as safeSpawnSync } from './win-exec.js'
import { describePortAttribution, diagnosePort } from './port-diagnosis.js'
import type { PreflightCheck, PreflightInput } from '../types/preflight.js'

/** Environment readiness: Node, package manager, Docker. Runs before the prompts. */
export async function runEnvPreflight(input: PreflightInput): Promise<PreflightCheck[]> {
    const minNodeMajor = input.minNodeMajor ?? 24
    const checks: PreflightCheck[] = [nodeCheck(minNodeMajor), ...pmChecks(input.pm)]
    if (input.needsDocker) checks.push(dockerCheck())
    return checks
}

function nodeCheck(minNodeMajor: number): PreflightCheck {
    const nodeMajor = Number(process.versions.node.split('.')[0])
    return {
        label: `Node ≥ ${minNodeMajor}`,
        state: nodeMajor >= minNodeMajor ? 'ok' : 'fail',
        detail: `current: ${process.version}`,
    }
}

export interface PmChecksOptions {
    /** Replaces the default detail on the not-on-PATH row. */
    notFoundDetail?: string
    /** State of the below-PNPM_MIN row. */
    belowMinState?: 'fail' | 'warn'
}

/** Package manager on PATH, plus the pnpm version gate when the pm is pnpm. */
export function pmChecks(pm: string, opts: PmChecksOptions = {}): PreflightCheck[] {
    const pmCheck = safeSpawnSync(pm, ['--version'], { encoding: 'utf8', timeout: 5000 })
    const pmOnPath = pmCheck.status === 0
    const checks: PreflightCheck[] = [
        {
            label: `${pm} on PATH`,
            state: pmOnPath ? 'ok' : 'fail',
            detail: pmOnPath
                ? undefined
                : opts.notFoundDetail
                ?? `\`${pm}\` not found; run \`npm i -g ${PNPM_PIN}\`, or pass --pm npm to use npm instead`,
        },
    ]

    if (pmOnPath && pm === 'pnpm') {
        checks.push(...pnpmVersionChecks((pmCheck.stdout ?? '').trim(), opts.belowMinState))
    }
    return checks
}

/** pnpm version gate: below PNPM_MIN fails, below the tested PNPM_PIN warns. */
export function pnpmVersionChecks(
    installed: string,
    belowMinState: 'fail' | 'warn' = 'fail',
): PreflightCheck[] {
    if (!installed) return []
    if (semverLt(installed, PNPM_MIN)) {
        return [
            {
                label: `pnpm ≥ ${PNPM_MIN}`,
                state: belowMinState,
                detail: `you have ${installed}; battlestack needs pnpm ${PNPM_MIN} or newer, so run `
                    + `\`npm i -g ${PNPM_PIN}\`, or pass --pm npm to use npm instead`,
            },
        ]
    }
    if (semverLt(installed, PNPM_PIN_VERSION)) {
        return [
            {
                label: 'pnpm up to date',
                state: 'warn',
                detail: `battlestack is tested with pnpm ${PNPM_PIN_VERSION}; you have ${installed}, `
                    + 'so run `pnpm self-update`',
            },
        ]
    }
    return []
}

function dockerCheck(): PreflightCheck {
    const dockerCli = safeSpawnSync('docker', ['--version'], { stdio: 'ignore', timeout: 5000 })
    if (dockerCli.status !== 0) {
        return {
            label: 'Docker on PATH',
            state: 'fail',
            detail: 'Docker Desktop / OrbStack required for nuxt4:database',
        }
    }
    // A timeout (status null) counts the same as a failed daemon.
    const daemon = safeSpawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
        stdio: 'ignore',
        timeout: 5000,
    })
    return {
        label: 'Docker daemon',
        state: daemon.status === 0 ? 'ok' : 'fail',
        detail:
            daemon.status === 0
                ? undefined
                : 'docker daemon not reachable; start Docker Desktop / OrbStack',
    }
}

/** Availability of the project's allocated ports. Non-fatal: an occupied port warns. */
export async function runPortPreflight(
    ports: Array<{ port: number, label: string }>,
): Promise<PreflightCheck[]> {
    return Promise.all(
        ports.map(async ({ port, label }) => {
            const free = await isPortFree(port)
            if (free) return { label: `port ${port} (${label})`, state: 'ok' } satisfies PreflightCheck
            const diagnosis = await diagnosePort(port)
            return {
                label: `port ${port} (${label})`,
                state: 'warn',
                detail: `in use by ${describePortAttribution(diagnosis.attribution)}; stop it before `
                    + '`battlestack dev` (`battlestack down` / `battlestack prod:down` if it\'s a battlestack stack).',
            } satisfies PreflightCheck
        }),
    )
}

function checkIcon(state: PreflightCheck['state']): string {
    const sym = getUiPort().sym
    if (state === 'ok') return sym.ok
    if (state === 'warn') return sym.warn
    return sym.fail
}

/** Renders the check list and throws on any `fail`. Warnings continue. */
export function enforcePreflight(checks: PreflightCheck[]): void {
    const color = getUiPort().color
    for (const c of checks) {
        const icon = checkIcon(c.state)
        const detail = c.detail ? ` ${color.dim('(' + c.detail + ')')}` : ''
        console.log(`  ${icon} ${c.label}${detail}`)
    }
    const failed = checks.filter((c) => c.state === 'fail')
    if (failed.length > 0) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            `Preflight failed: ${failed.map((f) => f.label).join(', ')}. Fix the above + retry.`,
        )
    }
}

/** True if semver `a` is strictly older than `b` (major.minor.patch). */
function semverLt(a: string, b: string): boolean {
    const pa = a.split('.').map(Number)
    const pb = b.split('.').map(Number)
    for (let i = 0; i < 3; i++) {
        const x = pa[i] ?? 0
        const y = pb[i] ?? 0
        if (x !== y) return x < y
    }
    return false
}

async function isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const sock = net
            .createServer()
            .once('error', () => resolve(false))
            .once('listening', () => {
                sock.close(() => resolve(true))
            })
            .listen(port, '127.0.0.1')
    })
}
