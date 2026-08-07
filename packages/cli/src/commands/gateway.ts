import path from 'node:path'
import os from 'node:os'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import pc from 'picocolors'
import type { Ora } from 'ora'
import { ui } from '@battlestack/tui'
import {
    CLIError,
    CURRENT_NAME,
    dotDirName,
    ErrorCode,
    exists,
    hasMkcert,
    installLocalCa,
    issueWildcardCert,
    openBrowser,
    PRIOR_NAMES,
    run,
    supportsGateway,
    supportsHostsFile,
    supportsLocalTls,
    type ParsedArgs,
    type ReservedCommand,
} from '@battlestack/core'

// DNS-visible constant baked into generated compose/traefik/hosts entries.
export const GATEWAY_BASE_DOMAIN = `${CURRENT_NAME}.test`

// Real, fixed Docker identifiers.
const TRAEFIK_CONTAINER = `${CURRENT_NAME}-traefik`
const MITM_CONTAINER = `${CURRENT_NAME}-mitm`
const GATEWAY_NETWORK = `${CURRENT_NAME}-gateway`

// `.mitm-active` flags whether the compose stack should include mitm.
const STATE_FILE = (gatewayDir: string) => path.join(gatewayDir, '.mitm-active')
const ENV_FILE = (gatewayDir: string) => path.join(gatewayDir, '.env')

const MITM_RECOMMENDED_FILTER = '!~u nuxt !~u vite !~u ipx !~u favicon !~m WebSocket'

// Singleton Traefik. Projects register a dynamic router YAML in `dynamic/<project>.yml`.
export const GATEWAY_DIR = path.join(os.homedir(), dotDirName(CURRENT_NAME), 'gateway')
const COMPOSE_FILE = path.join(GATEWAY_DIR, 'docker-compose.yml')
const DYNAMIC_DIR = path.join(GATEWAY_DIR, 'dynamic')

function composeYml(tlsEnabled: boolean, mitmActive: boolean): string {
    // Modes: tls+mitm (mitm owns :443), tls only (traefik :443), no tls (traefik :443 plaintext).
    const traefikPorts = ['            - "80:80"']
    if (!mitmActive) {
        traefikPorts.push('            - "443:443"')
    }
    traefikPorts.push(`            - "8088:8080"   # dashboard (also at http://traefik.${GATEWAY_BASE_DOMAIN})`)

    const tlsVolume = tlsEnabled
        ? '            - ./certs:/etc/traefik/certs:ro\n'
        : ''

    // Same derivation `ensureTlsCert`/`tlsCertificatesYml` use for the written filename.
    const certName = GATEWAY_BASE_DOMAIN.replaceAll('.', '_')

    const mitmService = tlsEnabled && mitmActive
        ? `
    ${MITM_CONTAINER}:
        image: mitmproxy/mitmproxy:latest
        container_name: ${MITM_CONTAINER}
        restart: unless-stopped
        environment:
            PYTHONUNBUFFERED: "1"
        command:
            - mitmweb
            - --web-host=0.0.0.0
            - --web-port=8081
            - --listen-host=0.0.0.0
            - --listen-port=8443
            - --mode=reverse:http://${TRAEFIK_CONTAINER}:80
            - --set
            - keep_host_header=true
            - --set
            - web_open_browser=false
            - --set
            - web_password=\${MITM_TOKEN}
            - --set
            - stream_large_bodies=1m
            - --certs
            - "*=/certs/${certName}_combined.pem"
        ports:
            - "443:8443"
            - "8081:8081"
        volumes:
            - ./certs:/certs:ro
        depends_on:
            - ${TRAEFIK_CONTAINER}
`
        : ''

    return `# Managed by ${CURRENT_NAME}. Edits will be overwritten on \`${CURRENT_NAME} gateway:up\`.
name: ${GATEWAY_NETWORK}

services:
    ${TRAEFIK_CONTAINER}:
        image: traefik:v3.5
        container_name: ${TRAEFIK_CONTAINER}
        restart: unless-stopped
        ports:
${traefikPorts.join('\n')}
        volumes:
            - ./traefik.yml:/etc/traefik/traefik.yml:ro
            - ./dynamic:/etc/traefik/dynamic:ro
${tlsVolume}        extra_hosts:
            - "host.docker.internal:host-gateway"
${mitmService}
networks:
    default:
        name: ${GATEWAY_NETWORK}
`
}

function traefikYml(tlsEnabled: boolean, mitmActive: boolean): string {
    // websecure binds :443 only when TLS is available and mitm isn't claiming it.
    const websecure = tlsEnabled && !mitmActive
        ? `
    websecure:
        address: ":443"
        http:
            tls: {}
`
        : ''

    return `# Managed by ${CURRENT_NAME}.
api:
    dashboard: true
    insecure: true

entryPoints:
    web:
        address: ":80"
${websecure}
providers:
    file:
        directory: /etc/traefik/dynamic
        watch: true

log:
    level: INFO
accessLog:
    format: json
    filters:
        statusCodes: ["100-599"]
`
}

/** One http + one https router per internal host. Only the configured entrypoint serves. */
function internalDynamicYml(): string {
    const hosts = [
        { id: 'traefik-dashboard', host: 'traefik', service: 'api@internal' },
        { id: 'mitm', host: 'mitm', service: 'mitm-ui' },
    ]
    const routers = hosts.flatMap((h) => [
        `        ${h.id}-http:`,
        `            rule: "Host(\`${h.host}.${GATEWAY_BASE_DOMAIN}\`)"`,
        `            entryPoints: ["web"]`,
        `            service: ${h.service}`,
        `        ${h.id}-https:`,
        `            rule: "Host(\`${h.host}.${GATEWAY_BASE_DOMAIN}\`)"`,
        `            entryPoints: ["websecure"]`,
        `            service: ${h.service}`,
        `            tls: {}`,
    ])
    return `# Managed by ${CURRENT_NAME}.
http:
    routers:
${routers.join('\n')}
    services:
        mitm-ui:
            loadBalancer:
                servers:
                    - url: "http://${MITM_CONTAINER}:8081"
`
}

/** Configure Traefik to use the mkcert-issued wildcard cert on websecure. */
function tlsCertificatesYml(): string {
    const certName = GATEWAY_BASE_DOMAIN.replaceAll('.', '_')
    return `# Managed by ${CURRENT_NAME}.
tls:
    certificates:
        - certFile: /etc/traefik/certs/${certName}.pem
          keyFile: /etc/traefik/certs/${certName}-key.pem
    stores:
        default:
            defaultCertificate:
                certFile: /etc/traefik/certs/${certName}.pem
                keyFile: /etc/traefik/certs/${certName}-key.pem
`
}

const INTERNAL_HOSTNAMES = ['traefik', 'mitm']

// Metadata only: `project.ts` builds the actual `run` closures.
export const gatewayReservedMetas: Array<Omit<ReservedCommand, 'run'>> = [
    {
        name: 'gateway:up',
        usage: 'battlestack gateway:up',
        label: 'start battlestack-gateway (singleton Traefik)',
        group: 'Gateway / mitm',
    },
    {
        name: 'gateway:down',
        usage: 'battlestack gateway:down',
        label: 'stop',
        group: 'Gateway / mitm',
    },
    {
        name: 'gateway:status',
        usage: 'battlestack gateway:status',
        label: 'state + registered routes',
        group: 'Gateway / mitm',
    },
    {
        name: 'mitm',
        usage: 'battlestack mitm',
        label: 'launch mitmweb (HTTPS inspection)',
        group: 'Gateway / mitm',
    },
    {
        name: 'mitm:stop',
        usage: 'battlestack mitm:stop',
        label: 'tear it down',
        group: 'Gateway / mitm',
    },
]

export async function gatewayCommand(args: ParsedArgs, _loader: Ora): Promise<void> {
    const sub = args.secondPositional ?? 'status'
    if (sub === 'up') return gatewayUp()
    if (sub === 'down') return gatewayDown()
    if (sub === 'status') return gatewayStatus()
    throw new CLIError(
        ErrorCode.SCAFFOLD_FAILED,
        `Unknown gateway subcommand: ${sub} (expected: up | down | status)`,
    )
}

/** Opt-in mitmweb launcher. Random token per call, opens browser. */
export async function mitmCommand(args: ParsedArgs, _loader: Ora): Promise<void> {
    const sub = args.secondPositional
    if (sub === 'stop' || sub === 'down') return mitmStop()

    if (!supportsGateway()) {
        printGatewayUnsupported()
        return
    }
    if (!(await hasMkcert())) {
        printGatewaySkippedNoMkcert()
        return
    }

    const token = randomBytes(8).toString('hex')
    await writeFile(STATE_FILE(GATEWAY_DIR), 'on\n')
    await writeFile(ENV_FILE(GATEWAY_DIR), `MITM_TOKEN=${token}\n`)

    await gatewayUp()

    const url = `http://mitm.${GATEWAY_BASE_DOMAIN}/?token=${token}`
    ui.blank()
    ui.ok(`mitm running at ${ui.color.accent(url)}`)
    ui.kv([
        ['password', `${token}  ${pc.dim('(regenerated next launch)')}`],
        ['stop', ui.cmd('battlestack mitm:stop')],
        ['filter', MITM_RECOMMENDED_FILTER],
    ])
    ui.blank()
    await openBrowser(url)
}

async function mitmStop(): Promise<void> {
    await rm(STATE_FILE(GATEWAY_DIR), { force: true })
    await rm(ENV_FILE(GATEWAY_DIR), { force: true })
    if (await exists(COMPOSE_FILE)) {
        ui.step('Stopping mitm; traefik takes :443 back')
        await gatewayUp()
    } else {
        ui.skip('battlestack gateway not configured, nothing to do')
    }
}

async function readMitmActive(): Promise<boolean> {
    return exists(STATE_FILE(GATEWAY_DIR))
}

/** @param priorNames overrides the real `PRIOR_NAMES`. Every real caller passes no arguments. */
export async function gatewayUp(priorNames: readonly string[] = PRIOR_NAMES): Promise<void> {
    if (!supportsGateway()) {
        printGatewayUnsupported()
        return
    }
    // Without mkcert, `battlestack dev` falls back to a localhost port.
    if (!(await hasMkcert())) {
        printGatewaySkippedNoMkcert()
        return
    }
    if (!(await hasDocker())) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            'Docker is required for the battlestack gateway. Install Docker Desktop and re-run.',
        )
    }
    const priorSingletons = await findPriorGatewaySingleton(priorNames)
    if (priorSingletons.length > 0) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            describePriorGatewaySingleton(priorSingletons),
        )
    }
    await mkdir(DYNAMIC_DIR, { recursive: true })

    const tlsEnabled = await ensureTlsCert()
    const mitmActive = await readMitmActive()
    await writeFile(COMPOSE_FILE, composeYml(tlsEnabled, mitmActive))
    await writeFile(path.join(GATEWAY_DIR, 'traefik.yml'), traefikYml(tlsEnabled, mitmActive))
    await writeFile(path.join(DYNAMIC_DIR, '_internal.yml'), internalDynamicYml())

    if (supportsHostsFile()) {
        for (const host of INTERNAL_HOSTNAMES) {
            try {
                await ensureGatewayHostsEntry(`${host}.${GATEWAY_BASE_DOMAIN}`)
            } catch {
                /* host port fallback covers this */
            }
        }
    }

    if (tlsEnabled) {
        await writeFile(path.join(DYNAMIC_DIR, '_tls.yml'), tlsCertificatesYml())
    } else {
        await rm(path.join(DYNAMIC_DIR, '_tls.yml'), { force: true })
    }

    if (await isRunning()) {
        await run('docker', ['compose', 'up', '-d', '--force-recreate', '--remove-orphans'], {
            cwd: GATEWAY_DIR,
            inherit: false,
        })
        ui.skip('battlestack gateway reloaded')
    } else {
        ui.step('Starting battlestack gateway (traefik)')
        await run('docker', ['compose', 'up', '-d', '--remove-orphans'], {
            cwd: GATEWAY_DIR,
            inherit: true,
        })
        ui.ok('battlestack gateway up')
    }

    const scheme = tlsEnabled ? 'https' : 'http'
    const routes = await listRoutes()
    ui.blank()
    if (routes.length > 0) {
        ui.plain(ui.color.title('Registered projects'))
        ui.kv(routes.map((r) => [r.hostname, `${scheme}://${r.hostname}`]))
    } else {
        ui.dim('No projects registered yet. Run `battlestack dev` in a project to register one.')
    }
    ui.blank()
    ui.plain(ui.color.title('Gateway'))
    const rows: Array<[string, string]> = [
        ['dashboard', `${scheme}://traefik.${GATEWAY_BASE_DOMAIN}  ${pc.dim('(or http://localhost:8088)')}`],
        ['mailpit', 'per-project: `battlestack up` in a project starts its own (see .env for ports)'],
    ]
    if (tlsEnabled) {
        rows.push([
            'mitmproxy',
            mitmActive
                ? 'on: see browser tab opened by `battlestack mitm`'
                : 'off: `battlestack mitm` to start (random token, opens browser)',
        ])
    } else {
        rows.push(['https', 'off: install mkcert and re-run `battlestack gateway:up`'])
    }
    rows.push(['config', GATEWAY_DIR])
    ui.kv(rows)
}

async function ensureGatewayHostsEntry(hostname: string): Promise<void> {
    const { ensureHostsEntry } = await import('@battlestack/core')
    await ensureHostsEntry({ ip: '127.0.0.1', hostname })
}

function printGatewaySkippedNoMkcert(): void {
    ui.warn('battlestack-gateway skipped (mkcert not installed)')
    ui.dim('  Install mkcert to enable https://<project>.battlestack.test URLs:')
    ui.kv(
        [
            ['macOS', 'brew install mkcert nss'],
            ['Linux', 'https://github.com/FiloSottile/mkcert#linux'],
            ['Windows', 'choco install mkcert  (or scoop install mkcert)'],
        ],
        '    ',
    )
    ui.dim('  Then re-run `battlestack gateway:up`. `battlestack dev` works either way.')
}

function printGatewayUnsupported(): void {
    ui.warn('battlestack-gateway is disabled on WSL2')
    ui.dim('  WSL2 networking modes (Mirrored / VirtioProxy) + browser CA trust would')
    ui.dim('  all need manual setup, and even then the host routing path is fragile.')
    ui.dim('  `battlestack dev` falls back to a plain localhost port.')
    ui.dim('  Native Windows (no WSL) and macOS / Linux still get the gateway.')
}

/** Returns true when TLS is usable. The `.ca-installed` marker prevents repeat `mkcert -install`. */
async function ensureTlsCert(): Promise<boolean> {
    if (!supportsLocalTls()) return false
    if (!(await hasMkcert())) return false
    const certsDir = path.join(GATEWAY_DIR, 'certs')
    await mkdir(certsDir, { recursive: true })

    const caMarker = path.join(GATEWAY_DIR, '.ca-installed')
    if (!(await exists(caMarker))) {
        try {
            await installLocalCa()
            await writeFile(caMarker, new Date().toISOString() + '\n')
        } catch {
            return false
        }
    }

    const certName = GATEWAY_BASE_DOMAIN.replaceAll('.', '_')
    const certFile = path.join(certsDir, `${certName}.pem`)
    const keyFile = path.join(certsDir, `${certName}-key.pem`)
    if (!(await exists(certFile))) {
        await issueWildcardCert(certsDir, GATEWAY_BASE_DOMAIN)
    }

    // mitmproxy requires a single combined cert+key PEM.
    const combinedPath = path.join(certsDir, `${certName}_combined.pem`)
    const cert = await readFile(certFile, 'utf8')
    const key = await readFile(keyFile, 'utf8')
    await writeFile(combinedPath, cert + (cert.endsWith('\n') ? '' : '\n') + key)

    return true
}

export async function gatewayDown(): Promise<void> {
    if (!(await exists(COMPOSE_FILE))) {
        ui.skip('battlestack gateway not configured, nothing to stop')
        return
    }
    ui.step('Stopping battlestack gateway')
    await run('docker', ['compose', 'down'], { cwd: GATEWAY_DIR, inherit: true })
    ui.ok('battlestack gateway down')
}

export async function gatewayStatus(): Promise<void> {
    ui.section('battlestack gateway')
    ui.dim(`config: ${GATEWAY_DIR}`)
    if (!(await exists(COMPOSE_FILE))) {
        ui.warn('Not configured; run `battlestack gateway:up`')
        return
    }
    if (await isRunning()) {
        const tls = await exists(
            path.join(GATEWAY_DIR, 'certs', `${GATEWAY_BASE_DOMAIN.replaceAll('.', '_')}.pem`),
        )
        const mitm = await readMitmActive()
        const scheme = tls ? 'https' : 'http'
        ui.ok(`Running: project URLs at ${scheme}://<project>.${GATEWAY_BASE_DOMAIN}`)
        ui.kv([
            ['dashboard', `${scheme}://traefik.${GATEWAY_BASE_DOMAIN}  ${pc.dim('(or http://localhost:8088)')}`],
            ['mailpit', 'per-project (started by `battlestack up` in each project)'],
            ['mitm', mitm ? 'on  (run `battlestack mitm:stop` to disable)' : 'off  (run `battlestack mitm` to enable)'],
        ])
    } else {
        ui.warn('Configured but not running; `battlestack gateway:up`')
    }

    const routes = await listRoutes()
    if (routes.length === 0) {
        ui.blank()
        ui.dim('No project routes registered.')
        return
    }
    ui.section('Registered projects')
    ui.kv(
        routes.map((r) => {
            const id = pc.dim(`(${r.id})`)
            return [r.hostname, `http://${r.hostname}  →  host.docker.internal:${r.port} ${id}`]
        }),
    )
}

const DNS_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i
const ID_SAFE = /^[a-z0-9]([a-z0-9_-]{0,62})$/i

/** Reject hostnames containing characters that could break YAML / Traefik rules. */
function validateHostname(hostname: string): void {
    if (hostname.length === 0 || hostname.length > 253) {
        throw new CLIError(ErrorCode.SCAFFOLD_FAILED, `Invalid hostname (length): "${hostname}"`)
    }
    for (const label of hostname.split('.')) {
        if (!DNS_LABEL.test(label)) {
            throw new CLIError(
                ErrorCode.SCAFFOLD_FAILED,
                `Invalid hostname label "${label}" in "${hostname}" (alphanumeric + hyphen only)`,
            )
        }
    }
}

function validateRouteId(id: string): void {
    if (!ID_SAFE.test(id)) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            `Invalid route id "${id}" (must start with alphanumeric; only alphanumeric, _, - allowed)`,
        )
    }
}

function validatePort(port: number): void {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            `Invalid port ${port} (expected integer 1-65535)`,
        )
    }
}

/** Writes a per-project http+https router to the dynamic config dir. Traefik hot-reloads. */
export async function registerProject(
    id: string,
    hostname: string,
    port: number,
): Promise<void> {
    validateRouteId(id)
    validateHostname(hostname)
    validatePort(port)

    await mkdir(DYNAMIC_DIR, { recursive: true })
    const file = path.join(DYNAMIC_DIR, `${id}.yml`)
    const yml = `# Managed by ${CURRENT_NAME}: \`${CURRENT_NAME} dev\` rewrites on every boot.
http:
    routers:
        ${id}-http:
            rule: "Host(\`${hostname}\`)"
            entryPoints: ["web"]
            service: ${id}
        ${id}-https:
            rule: "Host(\`${hostname}\`)"
            entryPoints: ["websecure"]
            service: ${id}
            tls: {}
    services:
        ${id}:
            loadBalancer:
                servers:
                    - url: "http://host.docker.internal:${port}"
`
    await writeFile(file, yml)
}

export async function unregisterProject(id: string): Promise<void> {
    validateRouteId(id)
    const file = path.join(DYNAMIC_DIR, `${id}.yml`)
    await rm(file, { force: true })

    const [routes, running] = await Promise.all([listRoutes(), isRunning()])
    if (routes.length === 0 && running) {
        ui.skip('Last project unregistered, stopping battlestack gateway')
        await gatewayDown()
    }
}

interface Route {
    id: string
    hostname: string
    port: number
}

async function listRoutes(): Promise<Route[]> {
    if (!(await exists(DYNAMIC_DIR))) return []
    const files = (await readdir(DYNAMIC_DIR)).filter(
        (f) => f.endsWith('.yml') && !f.startsWith('_'),
    )
    const routes = await Promise.all(
        files.map(async (f): Promise<Route> => {
            const id = f.endsWith('.yml') ? f.slice(0, -'.yml'.length) : f
            const content = await readFile(path.join(DYNAMIC_DIR, f), 'utf8')
            const host = /Host\(`([^`]+)`\)/.exec(content)?.[1] ?? '?'
            const port = Number(/host\.docker\.internal:(\d+)/.exec(content)?.[1] ?? '0')
            return { id, hostname: host, port }
        }),
    )
    return routes
}

async function hasDocker(): Promise<boolean> {
    try {
        await run('docker', ['--version'], { inherit: false })
        return true
    } catch {
        return false
    }
}

async function isRunning(): Promise<boolean> {
    try {
        const r = await run(
            'docker',
            ['inspect', '--format', '{{.State.Running}}', TRAEFIK_CONTAINER],
            { inherit: false },
        )
        return r.stdout.trim() === 'true'
    } catch {
        return false
    }
}

/** Detects, never stops, a gateway still running under a prior name. */
export async function findPriorGatewaySingleton(
    names: readonly string[] = PRIOR_NAMES,
): Promise<string[]> {
    const found: string[] = []
    for (const name of names) {
        try {
            const r = await run(
                'docker',
                ['inspect', '--format', '{{.State.Running}}', `${name}-traefik`],
                { inherit: false },
            )
            if (r.stdout.trim() === 'true') found.push(name)
        } catch {
            /* not found, or docker unreachable (hasDocker() already gates the caller) */
        }
    }
    return found
}

export function describePriorGatewaySingleton(names: string[]): string {
    const containers = names.flatMap((n) => [`${n}-traefik`, `${n}-mitm`]).join(' ')
    const networks = names.map((n) => `${n}-gateway`).join(' ')
    return `A gateway singleton from a previous name is still running (${names.map((n) => `"${n}-traefik"`).join(', ')}), `
        + `bound to the same fixed ports this gateway needs (80/443/8088). `
        + `Stop it first: \`docker rm -f ${containers}\`, then \`docker network rm ${networks}\`.`
}
