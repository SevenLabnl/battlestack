import { createHash } from 'node:crypto'
import net from 'node:net'
import { readDotEnv } from './dotenv.js'
import { enabledHas } from '../run-context.js'
import { CLIError, ErrorCode } from './errors.js'
import { diagnosePort, type PortDiagnosis } from './port-diagnosis.js'
import type { PortKind, ProjectPort } from '../types/ports.js'
import type { BattlestackRegistries } from '../registry.js'

/** True when nothing is listening on `port`. Racy: a later bind can still lose. */
export function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
    return new Promise((resolve) => {
        const sock = net.createServer()
            .once('error', () => resolve(false))
            .once('listening', () => sock.close(() => resolve(true)))
            .listen(port, host)
    })
}

// Per-project port: `1` prefixed to the service default (1xxxx → xxxx) plus a hash offset.
// Ranges are non-overlapping, 500-1000 slots wide.
const RANGES: Record<PortKind, { base: number, range: number }> = {
    'app': { base: 13000, range: 1000 }, // 1 + 3000 (Nuxt)
    'db': { base: 15432, range: 1000 }, // 1 + 5432 (Postgres)
    'smtp': { base: 11025, range: 1000 }, // 1 + 1025 (Mailpit SMTP)
    'mail-ui': { base: 18025, range: 900 }, // 1 + 8025 (Mailpit UI)
    's3-api': { base: 19000, range: 500 }, // 1 + 9000 (MinIO API)
    's3-console': { base: 19500, range: 500 }, // moved up from 19050 to not overlap the widened s3-api range
    'mastra-studio': { base: 14111, range: 800 }, // 1 + 4111 (Mastra Studio default)
    // Not default-derived, unlike every other kind here.
    'redis': { base: 16500, range: 900 },
}

// The `.env` key each kind's host port is frozen under at scaffold time.
const ENV_KEYS: Partial<Record<PortKind, string>> = {
    'app': 'NUXT_PORT',
    'db': 'DB_PORT',
    'smtp': 'SMTP_PORT',
    'mail-ui': 'MAIL_UI_PORT',
    's3-api': 'S3_API_PORT',
    's3-console': 'S3_CONSOLE_PORT',
    'redis': 'REDIS_PORT',
    // 'mastra-studio' has no .env key; `battlestack mastra:studio` passes PORT itself.
}

// Process-lifetime overrides written by `probeAndFreezePorts`. `.env` is the cross-run store.
const frozen = new Map<string, number>()

function freezeKey(projectName: string, kind: PortKind): string {
    return `${projectName}:${kind}`
}

/** Override `allocatePort(projectName, kind)` for the rest of this process. */
export function freezePort(projectName: string, kind: PortKind, port: number): void {
    frozen.set(freezeKey(projectName, kind), port)
}

/** Test-only: clear every frozen override between test cases. */
export function resetFrozenPorts(): void {
    frozen.clear()
}

export function allocatePort(projectName: string, kind: PortKind): number {
    const override = frozen.get(freezeKey(projectName, kind))
    if (override !== undefined) return override
    const { base, range } = RANGES[kind]
    const digest = createHash('sha256').update(`${projectName}:${kind}`).digest()
    const offset = digest.readUInt16BE(0)
    return base + (offset % range)
}

/** Runtime port for `kind`. `.env` wins once scaffold wrote it, else the hash allocation. */
export async function resolvePort(
    projectDir: string,
    projectName: string,
    kind: PortKind,
    envKey: string | undefined = ENV_KEYS[kind],
): Promise<number> {
    if (envKey) {
        const env = await readDotEnv(projectDir)
        const fromEnv = Number(env.get(envKey))
        if (Number.isInteger(fromEnv) && fromEnv > 0 && fromEnv < 65536) return fromEnv
    }
    return allocatePort(projectName, kind)
}

/** Shorthand for the Nuxt dev/preview port (`.env` `NUXT_PORT`, hash fallback). */
export async function resolveAppPort(projectDir: string, projectName: string): Promise<number> {
    return resolvePort(projectDir, projectName, 'app')
}

/** The per-project ports a scaffold will bind, given its enabled features. */
export function projectPorts(
    projectName: string,
    enabled: ReadonlySet<string>,
    registries?: BattlestackRegistries,
): ProjectPort[] {
    const on = (id: string): boolean => enabledHas(enabled, id, registries)
    const services: Array<{ key: PortKind, label: string, on: boolean }> = [
        { key: 'app', label: 'app', on: true },
        { key: 'db', label: 'db (postgres)', on: on('nuxt4:database') },
        { key: 'smtp', label: 'smtp (mailpit)', on: on('nuxt4:auth') },
        { key: 'mail-ui', label: 'mail-ui (mailpit)', on: on('nuxt4:auth') },
        { key: 's3-api', label: 's3 (rustfs)', on: on('nuxt4:storage') },
        { key: 's3-console', label: 's3-console', on: on('nuxt4:storage') },
        { key: 'mastra-studio', label: 'mastra-studio', on: on('nuxt4:mastra') },
        { key: 'redis', label: 'redis (rate-limit accelerator)', on: on('nuxt4:redis') },
    ]
    return services
        .filter((s) => s.on)
        .map((s) => ({ port: allocatePort(projectName, s.key), label: s.label, kind: s.key }))
}

export interface PortAssignment {
    kind: PortKind
    label: string
    /** The hash-derived port `projectPorts` proposed. */
    preferred: number
    /** What actually got frozen; equals `preferred` unless it was busy. */
    port: number
    shifted: boolean
    /** Set only when `shifted`: what was occupying `preferred`. */
    diagnosis?: PortDiagnosis
}

/** Probes from each preferred port, wrapping inside the kind's range, and freezes the winner. */
export async function probeAndFreezePorts(
    projectName: string,
    wanted: ProjectPort[],
    opts: {
        isPortFree?: (port: number) => Promise<boolean>
        diagnosePort?: typeof diagnosePort
    } = {},
): Promise<PortAssignment[]> {
    const isFree = opts.isPortFree ?? isPortFree
    const diagnose = opts.diagnosePort ?? diagnosePort
    return Promise.all(
        wanted.map(async ({ port: preferred, label, kind }): Promise<PortAssignment> => {
            const { base, range } = RANGES[kind]
            let winner: number | undefined
            for (let i = 0; i < range; i++) {
                const candidate = base + ((preferred - base + i) % range)
                if (await isFree(candidate)) {
                    winner = candidate
                    break
                }
            }
            if (winner === undefined) {
                throw new CLIError(
                    ErrorCode.PORT_IN_USE,
                    `No free port available for "${label}" in range ${base}-${base + range - 1} `
                    + `(all ${range} slots occupied). Free one up or stop other battlestack projects, then retry.`,
                )
            }
            freezePort(projectName, kind, winner)
            const shifted = winner !== preferred
            return {
                kind,
                label,
                preferred,
                port: winner,
                shifted,
                diagnosis: shifted
                    ? await diagnose(preferred, { expectedComposeProject: projectName })
                    : undefined,
            }
        }),
    )
}
