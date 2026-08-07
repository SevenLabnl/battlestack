import path from 'node:path'
import { spawn } from 'node:child_process'
import { readdir, rm } from 'node:fs/promises'
import { exists } from './fs.js'
import { run } from './run.js'

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
    return new Promise((resolve) => {
        const child = spawn(
            'docker',
            ['ps', '-a', '--filter', `label=com.docker.compose.project=${projectName}`, '-q'],
            { stdio: ['ignore', 'pipe', 'ignore'] },
        )
        let out = ''
        child.stdout.on('data', (b: Buffer) => (out += b.toString()))
        child.on('error', () => resolve(false))
        child.on('close', () => resolve(out.trim().length > 0))
    })
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
    const ids = await new Promise<string[]>((resolve) => {
        const child = spawn(
            'docker',
            [
                listCmd,
                ...listArgs,
                '--filter',
                `label=com.docker.compose.project=${projectName}`,
            ],
            { stdio: ['ignore', 'pipe', 'ignore'] },
        )
        let out = ''
        child.stdout.on('data', (b: Buffer) => (out += b.toString()))
        child.on('error', () => resolve([]))
        child.on('close', () => resolve(out.split('\n').filter(Boolean)))
    })
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
