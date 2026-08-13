import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getUiPort } from '../ui-port.js'
import { spawnSyncResolved } from './win-exec.js'

// Public npm package name of the unscoped wrapper (`packages/battlestack`),
// the thing users install/run; kept in version lockstep with @battlestack/cli.
const PACKAGE_NAME = 'battlestack'
const CACHE_FILE = path.join(os.homedir(), '.battlestack', 'update-check.json')
const TTL_MS = 24 * 60 * 60 * 1000

interface Cache {
    checkedAt: number
    latest: string | null
}

/** Cached 24h, times out fast, never throws. Skipped in CI and with BATTLESTACK_NO_UPDATE_CHECK. */
export async function notifyIfOutdated(current: string): Promise<void> {
    try {
        if (process.env.CI || process.env.BATTLESTACK_NO_UPDATE_CHECK) return
        const latest = await latestVersion()
        if (!latest || !semverGt(latest, current)) return
        const ui = getUiPort()
        ui.blank()
        ui.warn(`A newer battlestack is available: ${current} → ${latest}`)
        ui.bullet('run `battlestack self-update`')
        ui.blank()
    } catch {
        // Best-effort.
    }
}

async function latestVersion(): Promise<string | null> {
    const cached = await readCache()
    if (cached && Date.now() - cached.checkedAt < TTL_MS) return cached.latest


    const res = spawnSyncResolved('npm', ['view', PACKAGE_NAME, 'version'], {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
    })
    const latest = res.status === 0 ? res.stdout.trim() || null : null
    await writeCache({ checkedAt: Date.now(), latest })
    return latest
}

async function readCache(): Promise<Cache | null> {
    try {
        return JSON.parse(await readFile(CACHE_FILE, 'utf8')) as Cache
    } catch {
        return null
    }
}

async function writeCache(cache: Cache): Promise<void> {
    try {
        await mkdir(path.dirname(CACHE_FILE), { recursive: true })
        await writeFile(CACHE_FILE, JSON.stringify(cache))
    } catch {
        // Best-effort.
    }
}

function semverGt(a: string, b: string): boolean {
    const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
    const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
    for (let i = 0; i < 3; i++) {
        const x = pa[i] ?? 0
        const y = pb[i] ?? 0
        if (x !== y) return x > y
    }
    return false
}
