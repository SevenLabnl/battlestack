import os from 'node:os'
import type { RuntimeHost } from '../types/platform.js'

export function runtimeHost(): RuntimeHost {
    const p = os.platform()
    if (p === 'darwin') return 'macos'
    if (p === 'win32') return 'windows'
    if (p === 'linux') return isWsl() ? 'wsl' : 'linux'
    return 'other'
}

function isWsl(): boolean {
    if (process.env.WSL_DISTRO_NAME) return true
    if (process.env.WSL_INTEROP) return true
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require('node:fs') as typeof import('node:fs')
        const v = fs.readFileSync('/proc/version', 'utf8').toLowerCase()
        return v.includes('microsoft') || v.includes('wsl')
    } catch {
        return false
    }
}

/** Whether the local-dev TLS path (mkcert + Traefik websecure + wildcard cert) applies. False on WSL2. */
export function supportsLocalTls(): boolean {
    const host = runtimeHost()
    if (host === 'wsl') return false
    return host === 'macos' || host === 'windows' || host === 'linux'
}

/** Whether `ensureHostsEntry` can succeed on this host. */
export function supportsHostsFile(): boolean {
    const host = runtimeHost()
    return host === 'macos' || host === 'windows'
}

/** Whether to bring up the battlestack gateway (singleton Traefik + mitm). False on WSL2. */
export function supportsGateway(): boolean {
    return runtimeHost() !== 'wsl'
}
