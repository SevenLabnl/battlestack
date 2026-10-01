import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ui } from '@battlestack/tui'
import { semverLt } from './commands/self-update.js'
import { readStoreEntries, resolvePluginRelease, storeDir, type PluginRelease } from './plugin-store.js'

export const AUTO_UPDATE_POLICIES = ['off', 'notify', 'apply'] as const
export type AutoUpdatePolicy = typeof AUTO_UPDATE_POLICIES[number]

const TTL_MS = 24 * 60 * 60 * 1000

interface PluginUpdateCache {
    checkedAt: number
    releases: Record<string, PluginRelease>
    /** Versions that installed but failed to load, per plugin. */
    rejected: Record<string, string>
}

interface HomeConfig {
    plugins?: { autoUpdate?: string }
}

function configFile(battlestackHome: string): string {
    return path.join(battlestackHome, 'config.json')
}

function cacheFile(battlestackHome: string): string {
    return path.join(battlestackHome, 'plugin-update-check.json')
}

async function readJson<T>(file: string): Promise<T | null> {
    try {
        return JSON.parse(await readFile(file, 'utf8')) as T
    } catch {
        return null
    }
}

async function writeJson(file: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(value, null, 4) + '\n')
}

function isPolicy(value: unknown): value is AutoUpdatePolicy {
    return AUTO_UPDATE_POLICIES.includes(value as AutoUpdatePolicy)
}

export async function readAutoUpdatePolicy(battlestackHome: string): Promise<AutoUpdatePolicy> {
    const policy = (await readJson<HomeConfig>(configFile(battlestackHome)))?.plugins?.autoUpdate
    return isPolicy(policy) ? policy : 'notify'
}

export async function setAutoUpdatePolicy(battlestackHome: string, value: string): Promise<void> {
    if (!isPolicy(value)) {
        throw new Error(`Unknown auto-update policy "${value}". Expected one of: ${AUTO_UPDATE_POLICIES.join(', ')}`)
    }
    const config = (await readJson<HomeConfig>(configFile(battlestackHome))) ?? {}
    config.plugins = { ...config.plugins, autoUpdate: value }
    await writeJson(configFile(battlestackHome), config)
    console.log(`Plugin auto-update: ${value}`)
}

function autoUpdateDisabled(): boolean {
    return Boolean(process.env.CI || process.env.BATTLESTACK_NO_UPDATE_CHECK)
}

async function readCache(battlestackHome: string): Promise<PluginUpdateCache> {
    const cache = await readJson<PluginUpdateCache>(cacheFile(battlestackHome))
    return { checkedAt: cache?.checkedAt ?? 0, releases: cache?.releases ?? {}, rejected: cache?.rejected ?? {} }
}

export async function recordRejectedVersion(battlestackHome: string, name: string, version: string): Promise<void> {
    try {
        const cache = await readCache(battlestackHome)
        cache.rejected[name] = version
        await writeJson(cacheFile(battlestackHome), cache)
    } catch {
        // Best-effort.
    }
}

/** Forces a fresh check and forgets rejected versions, which a new CLI may now load. */
export async function resetPluginUpdateCheck(battlestackHome: string): Promise<void> {
    await rm(cacheFile(battlestackHome), { force: true }).catch(() => {})
}

interface PendingUpdate {
    name: string
    from: string
    to: string
}

async function pendingUpdates(battlestackHome: string, cache: PluginUpdateCache): Promise<PendingUpdate[]> {
    const pending: PendingUpdate[] = []
    for (const entry of await readStoreEntries(battlestackHome)) {
        const target = cache.releases[entry.name]?.target
        if (entry.linked || !entry.installed || !target) continue
        if (!semverLt(entry.installed, target) || cache.rejected[entry.name] === target) continue
        pending.push({ name: entry.name, from: entry.installed, to: target })
    }
    return pending
}

/** Refreshes the cached registry check at most daily, then prints available updates under `notify`. */
export async function notifyOutdatedPlugins(battlestackHome: string): Promise<void> {
    try {
        if (autoUpdateDisabled()) return
        const policy = await readAutoUpdatePolicy(battlestackHome)
        if (policy === 'off') return

        const cache = await readCache(battlestackHome)
        if (Date.now() - cache.checkedAt >= TTL_MS) {
            const dir = storeDir(battlestackHome)
            const releases: Record<string, PluginRelease> = {}
            for (const entry of await readStoreEntries(battlestackHome)) {
                if (entry.linked) continue
                const release = resolvePluginRelease(dir, entry.name, false)
                if (release) releases[entry.name] = release
            }
            cache.checkedAt = Date.now()
            cache.releases = releases
            await writeJson(cacheFile(battlestackHome), cache)
        }

        if (policy !== 'notify') return
        const pending = await pendingUpdates(battlestackHome, cache)
        if (pending.length === 0) return
        ui.blank()
        ui.warn(pending.length === 1 ? 'A plugin update is available:' : 'Plugin updates are available:')
        for (const p of pending) ui.bullet(`${p.name} ${p.from} → ${p.to}`)
        ui.bullet('run `battlestack plugin update`, or `battlestack plugin auto-update apply` to install them automatically')
        ui.blank()
    } catch {
        // Best-effort.
    }
}

/** Under `apply`, installs updates found by the last check, in a child `plugin update`. */
export async function applyPendingPluginUpdates(battlestackHome: string): Promise<void> {
    try {
        if (autoUpdateDisabled()) return
        if (await readAutoUpdatePolicy(battlestackHome) !== 'apply') return
        const pending = await pendingUpdates(battlestackHome, await readCache(battlestackHome))
        const cliEntry = process.argv[1]
        if (pending.length === 0 || !cliEntry) return

        ui.step('Applying plugin updates')
        spawnSync(process.execPath, [cliEntry, 'plugin', 'update', ...pending.map((p) => p.name)], {
            stdio: 'inherit',
            env: { ...process.env, BATTLESTACK_NO_UPDATE_CHECK: '1' },
        })
    } catch {
        // Best-effort.
    }
}
