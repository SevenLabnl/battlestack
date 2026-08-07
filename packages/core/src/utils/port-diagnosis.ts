import { spawnSyncResolved } from './win-exec.js'

/** What is bound to a port. Evidence only: this module never infers a cause. */
export type PortAttribution
    = | {
        kind: 'docker'
        /** Container name (`docker ps`'s `Names`). */
        container: string
        /** `com.docker.compose.project` label, when the container has one. */
        composeProject?: string
        /** Set only when `expectedComposeProject` was passed and a compose label exists. */
        relation?: 'own' | 'other'
    }
    | { kind: 'process', pid: number, name?: string }
    | { kind: 'unknown' }

export interface PortDiagnosis {
    port: number
    attribution: PortAttribution
}

interface DiagnoseOpts {
    /** This run's compose project name. Enables `relation` on a docker attribution. */
    expectedComposeProject?: string
    spawn?: typeof spawnSyncResolved
}

/**
 * What's bound to `port`, most useful first: a Docker container, else an OS listener
 * (`lsof`/`ss`/PowerShell), else `unknown`. Best-effort: a failing tool falls through, never throws.
 */
export async function diagnosePort(port: number, opts: DiagnoseOpts = {}): Promise<PortDiagnosis> {
    const spawn = opts.spawn ?? spawnSyncResolved
    const docker = diagnoseDocker(port, spawn)
    if (docker) {
        const relation
            = opts.expectedComposeProject === undefined || docker.composeProject === undefined
                ? undefined
                : docker.composeProject === opts.expectedComposeProject ? 'own' : 'other'
        return { port, attribution: { ...docker, relation } }
    }
    const proc = diagnoseProcess(port, spawn)
    if (proc) return { port, attribution: proc }
    return { port, attribution: { kind: 'unknown' } }
}

/** One-line, UI-agnostic description of an attribution; embed in an error/warning message. */
export function describePortAttribution(attribution: PortAttribution): string {
    if (attribution.kind === 'docker') {
        if (attribution.relation === 'own') {
            return `this project's own Docker container (${attribution.container})`
        }
        if (attribution.composeProject) {
            return `a Docker container from the "${attribution.composeProject}" compose project (${attribution.container})`
        }
        return `a Docker container (${attribution.container})`
    }
    if (attribution.kind === 'process') {
        return attribution.name ? `${attribution.name} (pid ${attribution.pid})` : `pid ${attribution.pid}`
    }
    return 'an unknown process'
}

interface DockerRow {
    Names?: string
    Labels?: string
}

function diagnoseDocker(
    port: number,
    spawn: typeof spawnSyncResolved,
): { kind: 'docker', container: string, composeProject?: string } | null {
    const result = spawn('docker', ['ps', '--filter', `publish=${port}`, '--format', '{{json .}}'], {
        encoding: 'utf8',
        timeout: 5000,
    })
    if (result.status !== 0 || !result.stdout) return null
    const line = result.stdout.trim().split(/\r?\n/).find(Boolean)
    if (!line) return null
    try {
        const row = JSON.parse(line) as DockerRow
        const m = /(?:^|,)com\.docker\.compose\.project=([^,]*)/.exec(row.Labels ?? '')
        return { kind: 'docker', container: row.Names ?? 'unknown', composeProject: m?.[1] || undefined }
    } catch {
        return null
    }
}

function diagnoseProcess(port: number, spawn: typeof spawnSyncResolved): PortAttribution | null {
    if (process.platform === 'darwin') return diagnoseDarwin(port, spawn)
    if (process.platform === 'linux') return diagnoseLinux(port, spawn)
    if (process.platform === 'win32') return diagnoseWindows(port, spawn)
    return null
}

/** `lsof -iTCP:<port> -sTCP:LISTEN`: header row, then `COMMAND PID USER FD TYPE …` rows. */
function diagnoseDarwin(port: number, spawn: typeof spawnSyncResolved): PortAttribution | null {
    const result = spawn('lsof', [`-iTCP:${port}`, '-sTCP:LISTEN', '-n', '-P'], {
        encoding: 'utf8',
        timeout: 5000,
    })
    if (result.status !== 0 || !result.stdout) return null
    const row = result.stdout.trim().split(/\r?\n/)[1] // [0] is the header
    if (!row) return null
    const cols = row.trim().split(/\s+/)
    const pid = Number(cols[1])
    if (!Number.isInteger(pid)) return null
    return { kind: 'process', pid, name: cols[0] }
}

/** `ss -ltnp`: matching line looks like `... :<port> ... users:(("name",pid=123,fd=4))`. */
function diagnoseLinux(port: number, spawn: typeof spawnSyncResolved): PortAttribution | null {
    const result = spawn('ss', ['-ltnp'], { encoding: 'utf8', timeout: 5000 })
    if (result.status !== 0 || !result.stdout) return null
    const line = result.stdout.split(/\r?\n/).find((l) => new RegExp(`:${port}\\b`).test(l))
    if (!line) return null
    const m = /users:\(\("([^"]+)",pid=(\d+)/.exec(line)
    if (!m) return null
    return { kind: 'process', pid: Number(m[2]), name: m[1] }
}

/** PowerShell one-liner: resolve the listening owner's pid + process name in one round trip. */
function diagnoseWindows(port: number, spawn: typeof spawnSyncResolved): PortAttribution | null {
    const script
        = `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue `
        + '| Select-Object -First 1; if ($c) { $p = Get-Process -Id $c.OwningProcess -ErrorAction '
        + 'SilentlyContinue; "$($c.OwningProcess),$($p.ProcessName)" }'
    const result = spawn('powershell.exe', ['-NoProfile', '-Command', script], {
        encoding: 'utf8',
        timeout: 5000,
    })
    if (result.status !== 0 || !result.stdout?.trim()) return null
    const [pidStr, name] = result.stdout.trim().split(',')
    const pid = Number(pidStr)
    if (!Number.isInteger(pid)) return null
    return { kind: 'process', pid, name: name || undefined }
}
