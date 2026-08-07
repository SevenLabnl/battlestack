import { release } from 'node:os'
import { run } from './run.js'
import { getUiPort } from '../ui-port.js'

function openCommand(): string {
    // win32 is handled separately in `openBrowser`.
    return process.platform === 'darwin' ? 'open' : 'xdg-open'
}

/** WSL/WSL2 detection, by interop env var then kernel release string. */
function isWSL(): boolean {
    if (process.platform !== 'linux') return false
    if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true
    return /microsoft/i.test(release())
}

/** Opens a URL in the default browser. Failures are logged dim and swallowed. */
export async function openBrowser(url: string): Promise<void> {
    try {
        if (isWSL()) {
            await openFromWSL(url)
            return
        }
        if (process.platform === 'win32') {
            // `""` is the window-title placeholder.
            await run('cmd.exe', ['/c', 'start', '""', url], { inherit: false })
            return
        }
        await run(openCommand(), [url], { inherit: false })
    } catch {
        getUiPort().dim('  Could not auto-open browser; visit the URL above manually.')
    }
}

/** `wslview` if present, else PowerShell interop. */
async function openFromWSL(url: string): Promise<void> {
    try {
        await run('wslview', [url], { inherit: false })
    } catch {
        // PowerShell single-quote escaping: ' → ''
        const quoted = `'${url.replaceAll('\'', '\'\'')}'`
        await run('powershell.exe', ['-NoProfile', '-Command', `Start-Process ${quoted}`], {
            inherit: false,
        })
    }
}
