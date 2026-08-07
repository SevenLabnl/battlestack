import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    runtimeHost,
    supportsGateway,
    supportsHostsFile,
    supportsLocalTls,
} from '../src/utils/platform.js'

afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.WSL_DISTRO_NAME
    delete process.env.WSL_INTEROP
})

describe('runtimeHost', () => {
    it('maps darwin → macos and win32 → windows', () => {
        vi.spyOn(os, 'platform').mockReturnValue('darwin')
        expect(runtimeHost()).toBe('macos')
        vi.spyOn(os, 'platform').mockReturnValue('win32')
        expect(runtimeHost()).toBe('windows')
    })

    it('detects WSL on linux via WSL_DISTRO_NAME', () => {
        vi.spyOn(os, 'platform').mockReturnValue('linux')
        process.env.WSL_DISTRO_NAME = 'Ubuntu'
        expect(runtimeHost()).toBe('wsl')
    })

    it('maps unknown platforms to other', () => {
        vi.spyOn(os, 'platform').mockReturnValue('freebsd' as NodeJS.Platform)
        expect(runtimeHost()).toBe('other')
    })
})

describe('capability checks', () => {
    it('WSL: no local TLS, no gateway', () => {
        vi.spyOn(os, 'platform').mockReturnValue('linux')
        process.env.WSL_INTEROP = '/run/WSL/1_interop'
        expect(supportsLocalTls()).toBe(false)
        expect(supportsGateway()).toBe(false)
        expect(supportsHostsFile()).toBe(false)
    })

    it('macOS: TLS, gateway and hosts file all supported', () => {
        vi.spyOn(os, 'platform').mockReturnValue('darwin')
        expect(supportsLocalTls()).toBe(true)
        expect(supportsGateway()).toBe(true)
        expect(supportsHostsFile()).toBe(true)
    })
})
