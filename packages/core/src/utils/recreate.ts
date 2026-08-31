import path from 'node:path'
import { spawn } from 'node:child_process'
import { readdir, rm } from 'node:fs/promises'
import { exists } from './fs.js'
import { run } from './run.js'
import { getUiPort } from '../ui-port.js'

/**
 * An unreachable Docker daemon does not fail fast. On a host with Docker
 * installed but not running, `docker ps` sits on the socket or named pipe for
 * tens of seconds, so an unbounded probe hangs the CLI before it has printed
 * anything. Same bound the port probes in port-diagnosis.ts use.
 */
const DOCKER_PROBE_TIMEOUT_MS = 5000
// The teardown writes get longer ropes than the probes — a `compose down -v`
// legitimately takes a while — but must not hang forever on the same dead socket.
const DOCKER_DOWN_TIMEOUT_MS = 60_000
const DOCKER_RM_TIMEOUT_MS = 15_000

/** Non-empty stdout lines; empty when docker is absent, broken or too slow. */
function dockerLines(args: string[]): Promise<{ lines: string[], timedOut: boolean }> {
    return new Promise((resolve) => {
        let settled = false
        let timer: NodeJS.Timeout | undefined
        const finish = (result: { lines: string[], timedOut: boolean }): void => {
            if (settled) return
            settled = true
            if (timer) clearTimeout(timer)
            resolve(result)
        }

        const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'ignore'] })
        timer = setTimeout(() => {
            child.kill()
            finish({ lines: [], timedOut: true })
        }, DOCKER_PROBE_TIMEOUT_MS)

        let out = ''
        child.stdout.on('data', (b: Buffer) => (out += b.toString()))
        child.on('error', () => finish({ lines: [], timedOut: false }))
        // Trimmed per line: docker on Windows terminates with CRLF, and a
        // trailing \r rides along into the `docker rm <id>` that follows.
        child.on('close', () =>
            finish({
                lines: out.split('\n').map((l) => l.trim()).filter(Boolean),
                timedOut: false,
            }))
    })
}

/**
 * A timed-out probe is not "no containers" — the daemon may just be slow, and
 * silently reporting the project clean lets a recreate wipe the directory while
 * the old containers and volumes survive to reattach to the fresh scaffold.
 */
function warnSlowDocker(projectName: string): void {
    getUiPort().warn(
        `docker did not answer within ${DOCKER_PROBE_TIMEOUT_MS / 1000}s — leftover containers or `
        + `volumes labeled "${projectName}" may survive; check with \`docker ps -a\` once the daemon responds`,
    )
}

/** Detects a previous scaffold by directory contents, manifest state, or docker compose label. */
export async function detectStale(
    projectName: string,
    projectDir: string,
): Promise<{ dir: boolean, docker: boolean, incomplete: boolean }> {
    if (!(await exists(projectDir))) {
        return { dir: false, docker: false, incomplete: false }
    }
    const [entries, dockerLeftover, incomplete] = await Promise.all([
        readdir(projectDir).catch(() => [] as string[]),
        detectComposeProject(projectName),
        detectIncompleteManifest(projectDir),
    ])
    return {
        dir: entries.length > 0,
        docker: dockerLeftover,
        incomplete,
    }
}

async function detectIncompleteManifest(projectDir: string): Promise<boolean> {
    const manifestPath = path.join(projectDir, '.battlestack', 'manifest.json')
    if (!(await exists(manifestPath))) return false
    try {
        const raw = await import('node:fs/promises').then((m) =>
            m.readFile(manifestPath, 'utf8'),
        )
        const parsed = JSON.parse(raw) as { incomplete?: boolean }
        return parsed.incomplete === true
    } catch {
        return false
    }
}

/** True when any container is labeled `com.docker.compose.project=<projectName>`. */
export async function detectComposeProject(projectName: string): Promise<boolean> {
    const { lines, timedOut } = await dockerLines([
        'ps',
        '-a',
        '--filter',
        `label=com.docker.compose.project=${projectName}`,
        '-q',
    ])
    if (timedOut) warnSlowDocker(projectName)
    return lines.length > 0
}

/** Best-effort. */
export async function dockerTeardown(
    projectName: string,
    projectDir: string,
): Promise<void> {
    if (await exists(path.join(projectDir, 'docker-compose.yml'))) {
        try {
            await run('docker', ['compose', 'down', '-v', '--remove-orphans'], {
                cwd: projectDir,
                inherit: false,
                timeoutMs: DOCKER_DOWN_TIMEOUT_MS,
            })
            return
        } catch {
            /* fall through to label cleanup */
        }
    }
    await rmByLabel('ps', ['-aq'], projectName, 'rm', ['-f'])
    await rmByLabel('volume', ['ls', '-q'], projectName, 'volume', ['rm'])
}

async function rmByLabel(
    listCmd: string,
    listArgs: string[],
    projectName: string,
    rmCmd: string,
    rmArgs: string[],
): Promise<void> {
    const { lines: ids, timedOut } = await dockerLines([
        listCmd,
        ...listArgs,
        '--filter',
        `label=com.docker.compose.project=${projectName}`,
    ])
    if (timedOut) warnSlowDocker(projectName)
    for (const id of ids) {
        try {
            await run('docker', [rmCmd, ...rmArgs, id], {
                inherit: false,
                timeoutMs: DOCKER_RM_TIMEOUT_MS,
            })
        } catch {
            /* best-effort */
        }
    }
}

/** Drops docker containers and volumes, then removes the project directory. */
export async function recreateProject(
    projectName: string,
    projectDir: string,
): Promise<void> {
    if (await detectComposeProject(projectName)) {
        await dockerTeardown(projectName, projectDir)
    }
    if (await exists(projectDir)) {
        await rm(projectDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
}

/** One-line summary of what `recreateProject` will remove. */
export function describeStale(
    projectName: string,
    projectDir: string,
    stale: { dir: boolean, docker: boolean, incomplete?: boolean },
): string {
    const parts: string[] = []
    if (stale.incomplete) parts.push('INCOMPLETE manifest from a crashed prior run')
    if (stale.dir) parts.push(`dir ${projectDir}/`)
    if (stale.docker) parts.push(`docker compose project "${projectName}"`)
    return parts.join(' + ')
}
