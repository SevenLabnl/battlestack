import net from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
    allocatePort,
    freezePort,
    isPortFree,
    probeAndFreezePorts,
    projectPorts,
    resetFrozenPorts,
    resolveAppPort,
    resolvePort,
} from '../src/utils/port-alloc.js'
import type { PortKind } from '../src/types/ports.js'

describe('isPortFree', () => {
    it('reports false while a port is bound and true once released', async () => {
        const server = net.createServer()
        const port: number = await new Promise((resolve) => {
            server.listen(0, '127.0.0.1', () => {
                resolve((server.address() as net.AddressInfo).port)
            })
        })

        expect(await isPortFree(port)).toBe(false)

        await new Promise<void>((resolve) => server.close(() => resolve()))
        expect(await isPortFree(port)).toBe(true)
    })
})

describe('allocatePort', () => {
    afterEach(() => {
        resetFrozenPorts()
    })

    it('is deterministic: same name + kind always yields the same port', () => {
        expect(allocatePort('demo', 'app')).toBe(allocatePort('demo', 'app'))
    })

    it('different projects get different ports (hash spread)', () => {
        expect(allocatePort('project-a', 'app')).not.toBe(allocatePort('project-b', 'app'))
    })

    // Widened pre-publish; see the RANGES comment in port-alloc.ts.
    const RANGES: Record<PortKind, { base: number, range: number }> = {
        'smtp': { base: 11025, range: 1000 },
        'app': { base: 13000, range: 1000 },
        'mastra-studio': { base: 14111, range: 800 },
        'db': { base: 15432, range: 1000 },
        'redis': { base: 16500, range: 900 },
        'mail-ui': { base: 18025, range: 900 },
        's3-api': { base: 19000, range: 500 },
        's3-console': { base: 19500, range: 500 },
    }

    it('stays inside each service range', () => {
        for (const name of ['a', 'kleentec', 'battlestack-very-long-project-name']) {
            for (const kind of Object.keys(RANGES) as PortKind[]) {
                const { base, range } = RANGES[kind]
                const port = allocatePort(name, kind)
                expect(port).toBeGreaterThanOrEqual(base)
                expect(port).toBeLessThan(base + range)
            }
        }
    })

    it('no two ranges overlap', () => {
        const spans = Object.values(RANGES)
            .map(({ base, range }) => [base, base + range - 1] as const)
            .sort((a, b) => a[0] - b[0])
        for (let i = 1; i < spans.length; i++) {
            expect(spans[i]![0]).toBeGreaterThan(spans[i - 1]![1])
        }
    })

    it('a frozen port overrides the hash until reset', () => {
        const hash = allocatePort('demo', 'db')
        freezePort('demo', 'db', hash + 1)
        expect(allocatePort('demo', 'db')).toBe(hash + 1)
        resetFrozenPorts()
        expect(allocatePort('demo', 'db')).toBe(hash)
    })

    it('freezing one kind does not affect another kind or another project', () => {
        const otherKindHash = allocatePort('demo', 'app')
        const otherProjectHash = allocatePort('other', 'db')
        freezePort('demo', 'db', 99999)
        expect(allocatePort('demo', 'app')).toBe(otherKindHash)
        expect(allocatePort('other', 'db')).toBe(otherProjectHash)
    })
})

describe('resolveAppPort', () => {
    let dir: string

    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'battlestack-port-'))
    })

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true })
        resetFrozenPorts()
    })

    it('prefers NUXT_PORT from .env over the hash allocation', async () => {
        await writeFile(path.join(dir, '.env'), 'NUXT_PORT=13820\n')
        expect(await resolveAppPort(dir, 'renamed-project')).toBe(13820)
    })

    it('falls back to the hash allocation when .env is missing', async () => {
        expect(await resolveAppPort(dir, 'demo')).toBe(allocatePort('demo', 'app'))
    })

    it('falls back when NUXT_PORT is absent or not a valid port', async () => {
        await writeFile(path.join(dir, '.env'), 'NUXT_PORT=banana\nOTHER=1\n')
        expect(await resolveAppPort(dir, 'demo')).toBe(allocatePort('demo', 'app'))
    })

    it('resolvePort reads each kind\'s .env key', async () => {
        await writeFile(path.join(dir, '.env'), 'DB_PORT=15500\nMAIL_UI_PORT=18099\n')
        expect(await resolvePort(dir, 'demo', 'db')).toBe(15500)
        expect(await resolvePort(dir, 'demo', 'mail-ui')).toBe(18099)
        expect(await resolvePort(dir, 'demo', 's3-console')).toBe(allocatePort('demo', 's3-console'))
    })

    it('resolvePort honors an explicit envKey override', async () => {
        await writeFile(path.join(dir, '.env'), 'NUXT_PORT=13820\nAPP_PORT=13700\n')
        expect(await resolvePort(dir, 'demo', 'app', 'APP_PORT')).toBe(13700)
    })

    it('mastra-studio has no .env key: always the hash', async () => {
        await writeFile(path.join(dir, '.env'), 'NUXT_PORT=13820\n')
        expect(await resolvePort(dir, 'demo', 'mastra-studio')).toBe(allocatePort('demo', 'mastra-studio'))
    })
})

describe('projectPorts', () => {
    it('always includes the app port', () => {
        const ports = projectPorts('demo', new Set())
        expect(ports.map((p) => p.label)).toEqual(['app'])
        expect(ports[0]!.kind).toBe('app')
    })

    it('adds service ports per enabled feature', () => {
        const ports = projectPorts(
            'demo',
            new Set(['nuxt4:database', 'nuxt4:auth', 'nuxt4:storage', 'nuxt4:mastra', 'nuxt4:redis']),
        )
        const labels = ports.map((p) => p.label)
        expect(labels).toContain('db (postgres)')
        expect(labels).toContain('smtp (mailpit)')
        expect(labels).toContain('mail-ui (mailpit)')
        expect(labels).toContain('s3 (rustfs)')
        expect(labels).toContain('s3-console')
        expect(labels).toContain('mastra-studio')
        expect(labels).toContain('redis (rate-limit accelerator)')
    })

    it('omits redis when nuxt4:redis is not enabled (the common case: accelerator, not floor)', () => {
        const ports = projectPorts('demo', new Set(['nuxt4:database', 'nuxt4:auth']))
        expect(ports.map((p) => p.label)).not.toContain('redis (rate-limit accelerator)')
    })
})

describe('probeAndFreezePorts', () => {
    afterEach(() => {
        resetFrozenPorts()
    })

    it('keeps the hash-preferred port when it is free, and freezes it', async () => {
        const wanted = projectPorts('probe-demo-free', new Set())
        const [assignment] = await probeAndFreezePorts('probe-demo-free', wanted, {
            isPortFree: async () => true,
        })
        expect(assignment!.shifted).toBe(false)
        expect(assignment!.port).toBe(assignment!.preferred)
        expect(assignment!.diagnosis).toBeUndefined()
        expect(allocatePort('probe-demo-free', 'app')).toBe(assignment!.port)
    })

    // Fake diagnosis stub; the real one shells out to docker/lsof/ss, which is
    // port-diagnosis.test.ts's job.
    const fakeDiagnosis = async (port: number) =>
        ({ port, attribution: { kind: 'unknown' as const } })

    it('linear-increments to the next free slot when the preferred port is busy', async () => {
        const wanted = projectPorts('probe-demo-busy', new Set())
        const preferred = wanted[0]!.port
        const busy = new Set([preferred])
        const [assignment] = await probeAndFreezePorts('probe-demo-busy', wanted, {
            isPortFree: async (port) => !busy.has(port),
            diagnosePort: fakeDiagnosis,
        })
        expect(assignment!.shifted).toBe(true)
        expect(assignment!.port).toBe(preferred + 1)
        expect(assignment!.diagnosis).toBeDefined()
        // The winner is frozen, so later allocatePort calls for this project agree.
        expect(allocatePort('probe-demo-busy', 'app')).toBe(preferred + 1)
    })

    it('wraps around the range instead of walking off the end', async () => {
        const wanted = projectPorts('probe-demo-wrap', new Set())
        const preferred = wanted[0]!.port
        const base = 13000
        const range = 1000
        // Busy from `preferred` to the end of the range, so it must wrap to `base`.
        const busy = new Set(Array.from({ length: base + range - preferred }, (_, i) => preferred + i))
        const [assignment] = await probeAndFreezePorts('probe-demo-wrap', wanted, {
            isPortFree: async (port) => !busy.has(port),
            diagnosePort: fakeDiagnosis,
        })
        expect(assignment!.port).toBeLessThan(preferred)
        expect(assignment!.port).toBeGreaterThanOrEqual(base)
    })

    it('throws a clear error when the whole range is exhausted', async () => {
        const wanted = projectPorts('probe-demo-exhausted', new Set())
        await expect(
            probeAndFreezePorts('probe-demo-exhausted', wanted, { isPortFree: async () => false }),
        ).rejects.toThrow(/No free port available/)
    })
})
