import path from 'node:path'
import { spawn } from 'node:child_process'
import { readdir, rm } from 'node:fs/promises'
import { exists } from './fs.js'
import { run } from './run.js'

/**
 * An unreachable Docker daemon does not fail fast. On a host with Docker
 * installed but not running, `docker ps` sits on the socket or named pipe for
 * tens of seconds, so an unbounded probe hangs the CLI before it has printed
 * anything. Same bound the port probes in port-diagnosis.ts use.
 */
const DOCKER_PROBE_TIMEOUT_MS = 5000

/** Non-empty stdout lines, or none when docker is absent, broken or too slow. */
function dockerLines(args: string[]): Promise<string[]> {
    return new Promise((resolve) => {
        let settled = false
        let timer: NodeJS.Timeout | undefined
        const finish = (lines: string[]): void => {
            if (settled) return
            settled = true
            if (timer) clearTimeout(timer)
            resolve(lines)
        }

        const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'ignore'] })
        timer = setTimeout(() => {
            child.kill()
            finish([])
        }, DOCKER_PROBE_TIMEOUT_MS)

        let out = ''
        child.stdout.on('data', (b: Buffer) => (out += b.toString()))
        child.on('error', () => finish([]))
        // Trimmed per line: docker on Windows terminates with CRLF, and a
        // trailing \r rides along into the `docker rm <id>` that follows.
        child.on('close', () => finish(out.split('\n').map((l) => l.trim()).filter(Boolean)))
    })
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
    const ids = await dockerLines([
        'ps',
        '-a',
        '--filter',
        `label=com.docker.compose.project=${projectName}`,
        '-q',
    ])
    return ids.length > 0
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
    const ids = await dockerLines([
        listCmd,
        ...listArgs,
        '--filter',
        `label=com.docker.compose.project=${projectName}`,
    ])
    for (const id of ids) {
        try {
            await run('docker', [rmCmd, ...rmArgs, id], { inherit: false })
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
