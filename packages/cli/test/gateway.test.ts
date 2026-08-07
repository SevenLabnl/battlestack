import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `GATEWAY_DIR` is computed ONCE at module load from `os.homedir()`, so faking homedir
 * must precede gateway.ts's first import or the module writes to the real home directory.
 */

const FAKE_HOME = path.join(os.tmpdir(), `battlestack-gateway-test-home-${randomUUID()}`)

vi.mock('node:os', async (importOriginal) => {
    // `Record<string, unknown>`, because @types/node does not model the `default` key
    // that ESM/CJS interop provides and `import os from 'node:os'` actually binds to.
    const actual = await importOriginal<Record<string, unknown>>()
    const fakeHomedir = (): string => FAKE_HOME
    return {
        ...actual,
        default: { ...(actual.default as object), homedir: fakeHomedir },
        homedir: fakeHomedir,
    }
})

const supportsGateway = vi.fn(() => true)
const supportsHostsFile = vi.fn(() => false)
const supportsLocalTls = vi.fn(() => true)
const hasMkcert = vi.fn(async () => true)
const installLocalCa = vi.fn(async () => {})
const issueWildcardCert = vi.fn(async (outDir: string, baseDomain: string) => {
    const certName = baseDomain.replaceAll('.', '_')
    const cert = `${certName}.pem`
    const key = `${certName}-key.pem`
    await writeFile(path.join(outDir, cert), '-----BEGIN CERTIFICATE-----\nstub\n-----END CERTIFICATE-----\n')
    await writeFile(path.join(outDir, key), '-----BEGIN PRIVATE KEY-----\nstub\n-----END PRIVATE KEY-----\n')
    return { cert, key }
})
const ensureHostsEntry = vi.fn(async (_entry: { ip: string, hostname: string }) => true)
const openBrowser = vi.fn(async () => {})

interface RunCall { cmd: string, args: string[] }
const runCalls: RunCall[] = []
/** `isRunning()`'s `docker inspect` result, set per test. */
let dockerRunning = false
/** Force a specific `run()` call (matched by args prefix) to reject. */
let runFailureMatcher: ((cmd: string, args: string[]) => boolean) | null = null

async function defaultRunImpl(cmd: string, args: string[]): Promise<{ stdout: string, stderr: string, code: number }> {
    runCalls.push({ cmd, args })
    if (runFailureMatcher?.(cmd, args)) throw new Error('mock run failure')
    if (cmd === 'docker' && args[0] === 'inspect') {
        return { stdout: dockerRunning ? 'true\n' : 'false\n', stderr: '', code: 0 }
    }
    return { stdout: '', stderr: '', code: 0 }
}
const run = vi.fn(defaultRunImpl)

vi.mock('@battlestack/core', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    run: (...a: Parameters<typeof run>) => run(...a),
    supportsGateway: () => supportsGateway(),
    supportsHostsFile: () => supportsHostsFile(),
    supportsLocalTls: () => supportsLocalTls(),
    hasMkcert: () => hasMkcert(),
    installLocalCa: () => installLocalCa(),
    issueWildcardCert: (...a: Parameters<typeof issueWildcardCert>) => issueWildcardCert(...a),
    ensureHostsEntry: (...a: Parameters<typeof ensureHostsEntry>) => ensureHostsEntry(...a),
    openBrowser: (...a: Parameters<typeof openBrowser>) => openBrowser(...a),
}))

const {
    describePriorGatewaySingleton,
    findPriorGatewaySingleton,
    GATEWAY_BASE_DOMAIN,
    GATEWAY_DIR,
    gatewayDown,
    gatewayStatus,
    gatewayUp,
    registerProject,
    unregisterProject,
} = await import('../src/commands/gateway.js')

beforeEach(async () => {
    // GATEWAY_DIR comes from a module-level constant, so it persists across tests in this
    // file. Wipe it so CA/compose/route state from one test cannot leak into the next.
    await rm(GATEWAY_DIR, { recursive: true, force: true })
    runCalls.length = 0
    dockerRunning = false
    runFailureMatcher = null
    run.mockReset()
    run.mockImplementation(defaultRunImpl)
    supportsGateway.mockReturnValue(true)
    supportsHostsFile.mockReturnValue(false)
    supportsLocalTls.mockReturnValue(true)
    hasMkcert.mockResolvedValue(true)
    installLocalCa.mockClear()
    issueWildcardCert.mockClear()
    ensureHostsEntry.mockClear()
    openBrowser.mockClear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
    vi.restoreAllMocks()
})

afterAll(async () => {
    await rm(FAKE_HOME, { recursive: true, force: true })
})

describe('GATEWAY_BASE_DOMAIN', () => {
    it('is the DNS-visible constant baked into every generated config', () => {
        // Regressing this silently breaks docker-compose.yml/traefik.yml/
        // hosts-file entries already written on disk for existing projects.
        expect(GATEWAY_BASE_DOMAIN).toBe('battlestack.test')
    })
})

// Container names are fixed at creation, so renaming the CLI neither stops nor adopts a
// prior-named singleton, and the new one dies binding its ports.
describe('findPriorGatewaySingleton', () => {
    it('detects a still-running container from a prior name', async () => {
        run.mockImplementation(async (cmd: string, args: string[]) => {
            runCalls.push({ cmd, args })
            if (cmd === 'docker' && args[0] === 'inspect' && args[3] === 'oldname-traefik') {
                return { stdout: 'true\n', stderr: '', code: 0 }
            }
            return { stdout: 'false\n', stderr: '', code: 0 }
        })
        expect(await findPriorGatewaySingleton(['oldname', 'older'])).toEqual(['oldname'])
    })

    it('returns empty when no prior singleton is running', async () => {
        expect(await findPriorGatewaySingleton(['oldname'])).toEqual([])
    })

    it('treats a docker error (container not found) as "not running", not a crash', async () => {
        run.mockImplementation(async () => {
            throw new Error('no such container')
        })
        expect(await findPriorGatewaySingleton(['oldname'])).toEqual([])
    })
})

describe('describePriorGatewaySingleton', () => {
    it('names the containers, network, and exact remediation commands', () => {
        const msg = describePriorGatewaySingleton(['oldname'])
        expect(msg).toContain('oldname-traefik')
        expect(msg).toContain('docker rm -f oldname-traefik oldname-mitm')
        expect(msg).toContain('docker network rm oldname-gateway')
    })
})

describe('gatewayUp: prior-name singleton preflight', () => {
    it('refuses to start when a prior-name singleton is still running', async () => {
        run.mockImplementation(async (cmd: string, args: string[]) => {
            runCalls.push({ cmd, args })
            if (cmd === 'docker' && args[0] === 'inspect' && args[3] === 'oldname-traefik') {
                return { stdout: 'true\n', stderr: '', code: 0 }
            }
            return { stdout: 'false\n', stderr: '', code: 0 }
        })
        await expect(gatewayUp(['oldname'])).rejects.toThrow(/oldname-traefik/)
        // Never got as far as writing its own compose file.
        await expect(readFile(path.join(GATEWAY_DIR, 'docker-compose.yml'), 'utf8')).rejects.toThrow()
    })

    it('starts normally when no prior-name singleton is found', async () => {
        await gatewayUp(['oldname'])
        await expect(readFile(path.join(GATEWAY_DIR, 'docker-compose.yml'), 'utf8')).resolves.toBeTruthy()
    })
})

describe('registerProject / unregisterProject', () => {
    it('rejects an invalid hostname', async () => {
        await expect(registerProject('demo', 'not a hostname!', 3000)).rejects.toThrow(/Invalid hostname/)
    })

    it('rejects an invalid route id', async () => {
        await expect(registerProject('bad id!', 'demo.battlestack.test', 3000)).rejects.toThrow(/Invalid route id/)
    })

    it('rejects an out-of-range port', async () => {
        await expect(registerProject('demo', 'demo.battlestack.test', 70_000)).rejects.toThrow(/Invalid port/)
        await expect(registerProject('demo', 'demo.battlestack.test', 0)).rejects.toThrow(/Invalid port/)
    })

    it('writes a router+service YAML with the right host and upstream port', async () => {
        await registerProject('demo', 'demo.battlestack.test', 4123)
        const content = await readFile(path.join(GATEWAY_DIR, 'dynamic', 'demo.yml'), 'utf8')
        expect(content).toContain('rule: "Host(`demo.battlestack.test`)"')
        expect(content).toContain('url: "http://host.docker.internal:4123"')
        expect(content).toContain('demo-http:')
        expect(content).toContain('demo-https:')
    })

    it('unregisterProject removes the route file', async () => {
        await registerProject('gone', 'gone.battlestack.test', 4124)
        await unregisterProject('gone')
        await expect(readFile(path.join(GATEWAY_DIR, 'dynamic', 'gone.yml'), 'utf8')).rejects.toThrow()
    })

    it('stops the gateway when the last route is removed and it is running', async () => {
        // gatewayDown() no-ops without a compose file on disk, so gatewayUp() runs first
        // to make `unregisterProject`'s stop call actually reach `docker compose down`.
        await gatewayUp()
        runCalls.length = 0
        await registerProject('only', 'only.battlestack.test', 4125)
        dockerRunning = true
        await unregisterProject('only')
        expect(runCalls.some((c) => c.cmd === 'docker' && c.args.join(' ') === 'compose down')).toBe(true)
    })

    it('does NOT stop the gateway when other routes remain', async () => {
        await registerProject('a', 'a.battlestack.test', 4126)
        await registerProject('b', 'b.battlestack.test', 4127)
        dockerRunning = true
        await unregisterProject('a')
        expect(runCalls.some((c) => c.cmd === 'docker' && c.args.join(' ') === 'compose down')).toBe(false)
        await unregisterProject('b') // cleanup for isolation from later tests
    })
})

describe('gatewayUp', () => {
    it('prints "disabled on WSL2" and touches nothing when unsupported', async () => {
        supportsGateway.mockReturnValue(false)
        await gatewayUp()
        expect(run).not.toHaveBeenCalled()
        await expect(readFile(path.join(GATEWAY_DIR, 'docker-compose.yml'), 'utf8')).rejects.toThrow()
    })

    it('skips (no compose file, no run calls) when mkcert is not installed', async () => {
        hasMkcert.mockResolvedValue(false)
        await gatewayUp()
        expect(run).not.toHaveBeenCalled()
        await expect(readFile(path.join(GATEWAY_DIR, 'docker-compose.yml'), 'utf8')).rejects.toThrow()
    })

    it('throws when Docker is unreachable', async () => {
        runFailureMatcher = (cmd) => cmd === 'docker'
        await expect(gatewayUp()).rejects.toThrow(/Docker is required/)
    })

    it('writes a plaintext (no-TLS) compose + traefik config when TLS is unsupported', async () => {
        supportsLocalTls.mockReturnValue(false)
        await gatewayUp()
        const compose = await readFile(path.join(GATEWAY_DIR, 'docker-compose.yml'), 'utf8')
        const traefik = await readFile(path.join(GATEWAY_DIR, 'traefik.yml'), 'utf8')
        expect(compose).not.toContain('./certs:/etc/traefik/certs:ro')
        expect(traefik).not.toContain('websecure:')
        expect(issueWildcardCert).not.toHaveBeenCalled()
    })

    it('writes a TLS-enabled compose + traefik config + _tls.yml when mkcert TLS is available', async () => {
        await gatewayUp()
        const compose = await readFile(path.join(GATEWAY_DIR, 'docker-compose.yml'), 'utf8')
        const traefik = await readFile(path.join(GATEWAY_DIR, 'traefik.yml'), 'utf8')
        const tls = await readFile(path.join(GATEWAY_DIR, 'dynamic', '_tls.yml'), 'utf8')
        expect(compose).toContain('./certs:/etc/traefik/certs:ro')
        expect(traefik).toContain('websecure:')
        expect(tls).toContain('certFile: /etc/traefik/certs/battlestack_test.pem')
        expect(issueWildcardCert).toHaveBeenCalledTimes(1)
    })

    it('only invokes mkcert -install once (subsequent runs reuse the .ca-installed marker)', async () => {
        await gatewayUp()
        await gatewayUp()
        expect(installLocalCa).toHaveBeenCalledTimes(1)
    })

    it('uses --force-recreate and reports "reloaded" when already running', async () => {
        dockerRunning = true
        await gatewayUp()
        const upCall = runCalls.find((c) => c.cmd === 'docker' && c.args[0] === 'compose' && c.args[1] === 'up')!
        expect(upCall.args).toContain('--force-recreate')
    })

    it('registers hosts-file entries only when supportsHostsFile() is true', async () => {
        supportsHostsFile.mockReturnValue(true)
        await gatewayUp()
        const hostnames = ensureHostsEntry.mock.calls.map((c) => (c[0] as { hostname: string }).hostname)
        expect(hostnames).toContain('traefik.battlestack.test')
        expect(hostnames).toContain('mitm.battlestack.test')
    })
})

describe('gatewayDown', () => {
    it('skips when not configured', async () => {
        await gatewayDown()
        expect(runCalls.some((c) => c.cmd === 'docker')).toBe(false)
    })

    it('runs `docker compose down` when configured', async () => {
        await gatewayUp()
        run.mockClear()
        runCalls.length = 0
        await gatewayDown()
        expect(runCalls.some((c) => c.cmd === 'docker' && c.args.join(' ') === 'compose down')).toBe(true)
    })
})

describe('gatewayStatus', () => {
    it('warns when not configured', async () => {
        const log = vi.mocked(console.log)
        await gatewayStatus()
        const printed = log.mock.calls.map((c) => c.join(' ')).join('\n')
        expect(printed).toContain('Not configured')
    })

    it('reports running + registered projects', async () => {
        await gatewayUp()
        await registerProject('status-demo', 'status-demo.battlestack.test', 4128)
        dockerRunning = true
        const log = vi.mocked(console.log)
        log.mockClear()
        await gatewayStatus()
        const printed = log.mock.calls.map((c) => c.join(' ')).join('\n')
        expect(printed).toContain('Running')
        expect(printed).toContain('status-demo.battlestack.test')
    })

    it('warns "configured but not running" otherwise', async () => {
        await gatewayUp()
        dockerRunning = false
        const log = vi.mocked(console.log)
        log.mockClear()
        await gatewayStatus()
        const printed = log.mock.calls.map((c) => c.join(' ')).join('\n')
        expect(printed).toContain('Configured but not running')
    })
})
