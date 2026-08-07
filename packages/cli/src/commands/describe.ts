import path from 'node:path'
import { spawn } from 'node:child_process'
import pc from 'picocolors'
import type { Ora } from 'ora'
import { ui } from '@battlestack/tui'
import {
    CLIError,
    enabledHas,
    ErrorCode,
    exists,
    findProjectRoot,
    readLocalState,
    readManifest,
    resolvePort,
    type BattlestackRegistries,
    type ParsedArgs,
    type PortKind,
    type ReservedCommand,
} from '@battlestack/core'

export const describeReservedMeta: Omit<ReservedCommand, 'run'> = {
    name: 'describe',
    usage: 'battlestack describe',
    label: 'show running services + ports + gateway state',
    group: 'Discovery',
}

interface DockerContainer {
    Names: string
    Image: string
    Status: string
    State: string
    Ports: string
}

/** Snapshot of this project's running services, ports and gateway. */
export async function describeCommand(
    _args: ParsedArgs,
    _loader: Ora,
    registries: BattlestackRegistries,
): Promise<void> {
    const projectDir = await findProjectRoot(process.cwd())
    if (!projectDir) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            'Not inside a battlestack project (no .battlestack/manifest.json found).',
        )
    }
    const manifest = await readManifest(projectDir, registries)
    if (!manifest) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            `No manifest at ${projectDir}/.battlestack/manifest.json`,
        )
    }
    const projectName = path.basename(projectDir)
    const enabled = new Set(manifest.features.map((f) => f.id))
    const local = await readLocalState(projectDir)
    const envExists = await exists(path.join(projectDir, '.env'))

    ui.section(projectName)
    ui.dim(`${manifest.framework}/${manifest.template} · ${manifest.packageManager} · cli v${manifest.cliVersion}`)
    if (envExists) ui.ok('.env present')
    else ui.warn('.env missing')

    type Service = { key: PortKind, label: string, scheme: 'http' | 'tcp', on: boolean }
    const services: Service[] = [
        { key: 'app', label: 'app', scheme: 'http', on: true },
        { key: 'db', label: 'db (postgres)', scheme: 'tcp', on: enabledHas(enabled, 'nuxt4:database', registries) },
        { key: 'smtp', label: 'smtp (mailpit)', scheme: 'tcp', on: enabledHas(enabled, 'nuxt4:auth', registries) },
        { key: 'mail-ui', label: 'mail-ui (mailpit)', scheme: 'http', on: enabledHas(enabled, 'nuxt4:auth', registries) },
        { key: 's3-api', label: 's3 (rustfs)', scheme: 'http', on: enabledHas(enabled, 'nuxt4:storage', registries) },
        { key: 's3-console', label: 's3-console', scheme: 'http', on: enabledHas(enabled, 'nuxt4:storage', registries) },
        { key: 'mastra-studio', label: 'mastra-studio', scheme: 'http', on: enabledHas(enabled, 'nuxt4:mastra', registries) },
        { key: 'redis', label: 'redis (rate-limit accelerator)', scheme: 'tcp', on: enabledHas(enabled, 'nuxt4:redis', registries) },
    ]
    ui.section('Endpoints')
    const rows: Array<[string, string]> = []
    for (const s of services) {
        if (!s.on) continue
        // The `.env`-frozen port wins over the name-hash.
        const port = await resolvePort(projectDir, projectName, s.key)
        const url
            = s.scheme === 'http'
                ? pc.cyan(`http://localhost:${port}`)
                : pc.dim(`localhost:${port}`)
        rows.push([s.label, url])
    }
    if (local?.gateway?.enabled && local.gateway.hostname) {
        rows.push(['gateway', pc.cyan(`https://${local.gateway.hostname}`)])
    }
    ui.kv(rows)

    ui.section('Containers')
    const containers = await listContainers(projectName)
    if (containers.length === 0) {
        ui.skip('No containers running')
    } else {
        for (const c of containers) {
            const dot = containerDot(c.State)
            console.log(`  ${dot} ${c.Names}  ${pc.dim(c.Status)}`)
        }
    }
    ui.blank()
}

function containerDot(state: string): string {
    if (state === 'running') return ui.sym.ok
    if (state === 'exited') return ui.sym.fail
    return ui.sym.warn
}

async function listContainers(projectName: string): Promise<DockerContainer[]> {
    return new Promise((resolve) => {
        const child = spawn(
            'docker',
            [
                'ps',
                '-a',
                '--filter',
                `label=com.docker.compose.project=${projectName}`,
                '--format',
                '{{json .}}',
            ],
            { stdio: ['ignore', 'pipe', 'ignore'] },
        )
        let out = ''
        child.stdout.on('data', (b: Buffer) => (out += b.toString()))
        child.on('error', () => resolve([]))
        child.on('close', () => {
            const rows: DockerContainer[] = []
            for (const line of out.trim().split('\n')) {
                if (!line) continue
                try {
                    rows.push(JSON.parse(line) as DockerContainer)
                } catch {
                    // Malformed line.
                }
            }
            resolve(rows)
        })
    })
}
