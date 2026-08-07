import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { run } from '../src/utils/run.js'
import { openBrowser } from '../src/utils/browser.js'

// openBrowser must never spawn a real browser from tests, so stub the runner.
vi.mock('../src/utils/run.js', () => ({
    run: vi.fn(async () => ({ stdout: '', stderr: '', code: 0 })),
}))

const runMock = vi.mocked(run)
const realPlatform = process.platform

function setPlatform(p: string): void {
    Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

beforeEach(() => {
    runMock.mockClear()
    runMock.mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    vi.unstubAllEnvs()
})

afterEach(() => {
    setPlatform(realPlatform)
    vi.unstubAllEnvs()
})

describe('openBrowser', () => {
    it('uses `open` on macOS', async () => {
        setPlatform('darwin')
        await openBrowser('https://example.test/x')
        expect(runMock).toHaveBeenCalledWith('open', ['https://example.test/x'], { inherit: false })
    })

    it('goes through cmd.exe /c start with a quoted title placeholder on Windows', async () => {
        // `start` is a cmd.exe builtin, not a file on disk, so spawning it directly
        // always ENOENTs and it must be routed through cmd.exe explicitly.
        setPlatform('win32')
        await openBrowser('https://example.test/x')
        expect(runMock).toHaveBeenCalledWith(
            'cmd.exe',
            ['/c', 'start', '""', 'https://example.test/x'],
            { inherit: false },
        )
    })

    it('uses xdg-open on plain Linux', async () => {
        setPlatform('linux')
        await openBrowser('https://example.test/x')
        expect(runMock).toHaveBeenCalledWith('xdg-open', ['https://example.test/x'], { inherit: false })
    })

    it('prefers wslview inside WSL', async () => {
        setPlatform('linux')
        vi.stubEnv('WSL_DISTRO_NAME', 'Ubuntu')
        await openBrowser('https://example.test/x')
        expect(runMock).toHaveBeenCalledWith('wslview', ['https://example.test/x'], { inherit: false })
    })

    it('falls back to PowerShell when wslview is missing, single-quoting the URL', async () => {
        setPlatform('linux')
        vi.stubEnv('WSL_INTEROP', '/run/WSL/1_interop')
        // First call (wslview) fails, second (powershell.exe) succeeds.
        runMock.mockRejectedValueOnce(new Error('not found'))
        await openBrowser('https://example.test/login?a=1&b=2')
        const psCall = runMock.mock.calls.at(-1)!
        expect(psCall[0]).toBe('powershell.exe')
        // Single-quoted so `&` in the query string survives PowerShell.
        expect(psCall[1]).toContain('Start-Process \'https://example.test/login?a=1&b=2\'')
    })

    it('doubles embedded single quotes for PowerShell', async () => {
        setPlatform('linux')
        vi.stubEnv('WSL_DISTRO_NAME', 'Ubuntu')
        runMock.mockRejectedValueOnce(new Error('not found'))
        await openBrowser('https://example.test/it\'s')
        const psCall = runMock.mock.calls.at(-1)!
        expect(psCall[1].join(' ')).toContain('\'https://example.test/it\'\'s\'')
    })

    it('swallows total failure instead of throwing', async () => {
        setPlatform('darwin')
        runMock.mockRejectedValue(new Error('no browser'))
        await expect(openBrowser('https://example.test/x')).resolves.toBeUndefined()
    })
})
