import net from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { enforcePreflight, runEnvPreflight, runPortPreflight } from '../src/utils/preflight.js'

describe('runEnvPreflight', () => {
    it('flags Node version against the requested floor', async () => {
        const tooHigh = await runEnvPreflight({ pm: 'pnpm', needsDocker: false, minNodeMajor: 999 })
        const nodeCheck = tooHigh.find((c) => c.label.startsWith('Node ≥'))
        expect(nodeCheck?.state).toBe('fail')

        const ok = await runEnvPreflight({ pm: 'pnpm', needsDocker: false, minNodeMajor: 1 })
        expect(ok.find((c) => c.label.startsWith('Node ≥'))?.state).toBe('ok')
    })

    it('checks the requested package manager', async () => {
        const checks = await runEnvPreflight({ pm: 'pnpm-totally-fake', needsDocker: false })
        const pmCheck = checks.find((c) => c.label.includes('on PATH'))
        expect(pmCheck?.state).toBe('fail')
    })

    it('only checks docker when needsDocker is set', async () => {
        const without = await runEnvPreflight({ pm: 'pnpm', needsDocker: false })
        expect(without.find((c) => /Docker/i.test(c.label))).toBeUndefined()

        const withDocker = await runEnvPreflight({ pm: 'pnpm', needsDocker: true })
        expect(withDocker.find((c) => /Docker/i.test(c.label))).toBeDefined()
    })
})

describe('runPortPreflight', () => {
    it('warns (not fails) on a busy port and names the service', async () => {
        const server = net.createServer()
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
        const port = (server.address() as net.AddressInfo).port
        try {
            const checks = await runPortPreflight([{ port, label: 'app' }])
            const portCheck = checks.find((c) => c.label.includes(`port ${port}`))
            expect(portCheck?.state).toBe('warn')
            expect(portCheck?.label).toContain('app')
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()))
        }
    })
})

describe('enforcePreflight', () => {
    it('throws when any check fails', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {})
        expect(() =>
            enforcePreflight([
                { label: 'ok thing', state: 'ok' },
                { label: 'broken thing', state: 'fail', detail: 'broken' },
            ]),
        ).toThrow(/Preflight failed/i)
        log.mockRestore()
    })

    it('passes through with only warnings + oks', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {})
        expect(() =>
            enforcePreflight([
                { label: 'a', state: 'ok' },
                { label: 'b', state: 'warn' },
            ]),
        ).not.toThrow()
        log.mockRestore()
    })
})
