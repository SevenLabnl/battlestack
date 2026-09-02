import net from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { enforcePreflight, pnpmVersionChecks, runEnvPreflight, runPortPreflight } from '../src/utils/preflight.js'
import { PNPM_MIN, PNPM_PIN } from '../src/constants/package-manager.js'

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

describe('pnpmVersionChecks', () => {
    const pin = PNPM_PIN.slice(PNPM_PIN.indexOf('@') + 1)

    it('fails below PNPM_MIN', () => {
        for (const old of ['11.2.9', '10.34.5', '10.31.0', '9.15.4']) {
            const checks = pnpmVersionChecks(old)
            expect(checks).toHaveLength(1)
            expect(checks[0]?.state).toBe('fail')
            expect(checks[0]?.label).toContain(PNPM_MIN)
            expect(checks[0]?.detail).toContain(old)
        }
    })

    it('only warns between PNPM_MIN and the tested pin', () => {
        for (const usable of [PNPM_MIN, '11.5.0', '11.7.9']) {
            const checks = pnpmVersionChecks(usable)
            expect(checks).toHaveLength(1)
            expect(checks[0]?.state).toBe('warn')
            expect(checks[0]?.detail).toContain(pin)
        }
    })

    it('is silent at or above the tested pin', () => {
        expect(pnpmVersionChecks(pin)).toEqual([])
        expect(pnpmVersionChecks('12.2.1')).toEqual([])
    })

    it('says nothing when the version could not be read', () => {
        expect(pnpmVersionChecks('')).toEqual([])
    })

    it('blocks the scaffold below PNPM_MIN and lets the pin nudge through', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {})
        expect(() => enforcePreflight(pnpmVersionChecks('11.2.0'))).toThrow(/Preflight failed/i)
        expect(() => enforcePreflight(pnpmVersionChecks('11.5.0'))).not.toThrow()
        log.mockRestore()
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
