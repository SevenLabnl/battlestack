import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { loadPlugins, PLUGIN_NAME_RE, spawnSyncResolved, type PluginSource } from '@battlestack/core'
import { computeGatedTarget, formatWindow, semverLt } from './commands/self-update.js'

/** A minimal npm project owned by the CLI at `<battlestackHome>/plugins`. Uses the user's npm auth. */

interface StorePkg {
    name: string
    private: true
    dependencies: Record<string, string>
}

export const PLUGIN_RELEASE_AGE_MINUTES = 3 * 24 * 60

export interface PluginRelease {
    /** What the `latest` dist-tag points at. */
    latest: string
    /** Newest stable version at or below `latest` that clears the release-age window. */
    target: string | null
}

export interface StoreEntry {
    name: string
    spec: string
    linked: boolean
    installed: string | null
}

export function storeDir(battlestackHome: string): string {
    return path.join(battlestackHome, 'plugins')
}

async function readStore(battlestackHome: string): Promise<{ dir: string; pkg: StorePkg }> {
    const dir = storeDir(battlestackHome)
    const file = path.join(dir, 'package.json')
    let pkg: StorePkg = { name: 'battlestack-plugin-store', private: true, dependencies: {} }
    if (existsSync(file)) pkg = JSON.parse(await readFile(file, 'utf8'))
    pkg.dependencies ??= {}
    return { dir, pkg }
}

async function writeStore(dir: string, pkg: StorePkg): Promise<void> {
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 4) + '\n')
}

export function installedVersion(dir: string, name: string): string | null {
    try {
        const pkg = JSON.parse(readFileSync(path.join(dir, 'node_modules', name, 'package.json'), 'utf8'))
        return typeof pkg.version === 'string' ? pkg.version : null
    } catch {
        return null
    }
}

export async function readStoreEntries(battlestackHome: string): Promise<StoreEntry[]> {
    const { dir, pkg } = await readStore(battlestackHome)
    return Object.entries(pkg.dependencies).map(([name, spec]) => ({
        name,
        spec,
        linked: spec.startsWith('file:'),
        installed: installedVersion(dir, name),
    }))
}

/** Rejects a name `discoverPlugins` would never load. */
function assertValidPluginName(name: string): void {
    if (PLUGIN_NAME_RE.test(name)) return
    throw new Error(
        `"${name}" isn't a valid battlestack plugin name, so it won't be loaded. Expected `
        + '"battlestack-plugin*" or "battlestack-preset*" (optionally scoped, e.g. '
        + `"@scope/battlestack-plugin-foo"). Rename the package (its package.json#name) and try again.`,
    )
}

function npm(dir: string, args: string[]): number | null {
    return spawnSyncResolved('npm', [...args, '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit' }).status
}

export async function pluginAdd(battlestackHome: string, spec: string): Promise<void> {
    const { dir, pkg } = await readStore(battlestackHome)
    if (existsSync(spec) || spec.startsWith('.') || path.isAbsolute(spec)) {
        // Local checkout: link by path.
        const abs = path.resolve(spec)
        const name = JSON.parse(await readFile(path.join(abs, 'package.json'), 'utf8')).name
        assertValidPluginName(name)
        pkg.dependencies[name] = `file:${abs}`
        await writeStore(dir, pkg)
        console.log(`Linked ${name} -> ${abs}`)
        return
    }
    assertValidPluginName(spec)
    pkg.dependencies[spec] = '*'
    await writeStore(dir, pkg)
    const result = spawnSyncResolved('npm', ['install', '--no-audit', '--no-fund'], {
        cwd: dir,
        stdio: 'inherit',
    })
    if (result.status !== 0) {
        throw new Error(`npm install failed (exit ${result.status ?? result.signal ?? 'unknown'})`)
    }
    console.log(`Installed ${spec}`)
}

export async function pluginRemove(battlestackHome: string, spec: string): Promise<void> {
    const { dir, pkg } = await readStore(battlestackHome)
    if (!(spec in pkg.dependencies)) {
        console.error(`${spec} is not installed`)
        return
    }
    if (npm(dir, ['uninstall', spec]) !== 0) {
        delete pkg.dependencies[spec]
        await writeStore(dir, pkg)
        console.log(`Removed ${spec} from the store; npm uninstall failed, so its files may remain in ${dir}`)
        return
    }
    console.log(`Removed ${spec}`)
}

export async function pluginList(battlestackHome: string): Promise<void> {
    const entries = await readStoreEntries(battlestackHome)
    if (entries.length === 0) {
        console.log('No plugins installed. Try: battlestack plugin add <package>')
        return
    }
    for (const e of entries) {
        const version = e.linked ? `linked -> ${e.spec.slice('file:'.length)}` : e.installed ?? 'not installed'
        console.log(`  ${e.name}  ${version}`)
    }
}

/** `latest` plus the newest version old enough to install, from the registry. Null when unreachable. */
export function resolvePluginRelease(dir: string, name: string, force: boolean): PluginRelease | null {
    const r = spawnSyncResolved('npm', ['view', name, 'dist-tags', 'time', '--json'], {
        cwd: existsSync(dir) ? dir : undefined,
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (r.status !== 0 || !r.stdout) return null
    try {
        const view = JSON.parse(r.stdout) as { 'dist-tags'?: Record<string, string>; time?: Record<string, string> }
        const latest = view['dist-tags']?.latest
        if (!latest) return null
        if (force) return { latest, target: latest }
        const eligible = Object.fromEntries(
            Object.entries(view.time ?? {}).filter(([version]) => !semverLt(latest, version)),
        )
        const gated = computeGatedTarget(latest, eligible, PLUGIN_RELEASE_AGE_MINUTES, Date.now())
        return { latest, target: gated.version }
    } catch {
        return null
    }
}

/** The load error for store plugin `name` among `sources`, else null. */
export async function storePluginLoadError(sources: PluginSource[], name: string): Promise<string | null> {
    try {
        const result = await loadPlugins(sources)
        return result.skipped.find((s) => s.specifier === name)?.error ?? null
    } catch (error) {
        return (error as Error).message ?? String(error)
    }
}

export interface PluginUpdateOptions {
    force?: boolean
    /** The load error for an installed plugin, else null. Defaults to loading it alone. */
    verify?: (name: string) => Promise<string | null>
    /** Called with a version that installed but failed to load and was rolled back. */
    onRejected?: (name: string, version: string) => Promise<void> | void
}

const STALE_LOCK_MS = 10 * 60 * 1000

/** Takes `<store>/.update.lock`; false while another live update holds it. */
async function acquireUpdateLock(lockFile: string): Promise<boolean> {
    await mkdir(path.dirname(lockFile), { recursive: true })
    try {
        await writeFile(lockFile, String(process.pid), { flag: 'wx' })
        return true
    } catch {
        const lock = await stat(lockFile).catch(() => null)
        if (lock && Date.now() - lock.mtimeMs < STALE_LOCK_MS) return false
        await writeFile(lockFile, String(process.pid))
        return true
    }
}

/** Updates registry-installed store plugins; returns false when any update failed. */
export async function pluginUpdate(
    battlestackHome: string,
    names: string[],
    options: PluginUpdateOptions = {},
): Promise<boolean> {
    const lockFile = path.join(storeDir(battlestackHome), '.update.lock')
    if (!(await acquireUpdateLock(lockFile))) {
        console.error('Another plugin update is running; try again shortly')
        return false
    }
    try {
        return await updateStoreEntries(battlestackHome, names, options)
    } finally {
        await rm(lockFile, { force: true })
    }
}

async function updateStoreEntries(
    battlestackHome: string,
    names: string[],
    options: PluginUpdateOptions,
): Promise<boolean> {
    const entries = await readStoreEntries(battlestackHome)
    const dir = storeDir(battlestackHome)
    const unknown = names.filter((n) => !entries.some((e) => e.name === n))
    for (const n of unknown) console.error(`${n} is not installed`)
    const selected = names.length > 0 ? entries.filter((e) => names.includes(e.name)) : entries
    if (selected.length === 0 && unknown.length === 0) {
        console.log('No plugins installed. Try: battlestack plugin add <package>')
    }

    let ok = unknown.length === 0
    for (const entry of selected) {
        if (entry.linked) {
            console.log(`  ${entry.name}  linked, skipped`)
            continue
        }
        const release = resolvePluginRelease(dir, entry.name, Boolean(options.force))
        if (!release) {
            console.error(`  ${entry.name}  registry unreachable, skipped`)
            ok = false
            continue
        }
        const current = entry.installed
        const target = release.target
        if (!target || (current && !semverLt(current, target))) {
            const heldBack = current ? semverLt(current, release.latest) : true
            console.log(`  ${entry.name}  ${current ?? 'not installed'}, up to date`)
            if (heldBack) {
                console.log(
                    `    ${release.latest} is newer but younger than ${formatWindow(PLUGIN_RELEASE_AGE_MINUTES)}; `
                    + '`battlestack plugin update --force` installs it now',
                )
            }
            continue
        }

        console.log(`  ${entry.name}  ${current ?? 'not installed'} → ${target}`)
        if (npm(dir, ['install', `${entry.name}@${target}`, '--save-exact']) !== 0) {
            console.error(`  ${entry.name}  npm install failed`)
            ok = false
            continue
        }
        const loadError = options.verify
            ? await options.verify(entry.name)
            : await storePluginLoadError([{ specifier: entry.name, via: 'store', required: false, basedir: dir }], entry.name)
        if (!loadError) continue

        ok = false
        console.error(`  ${entry.name}@${target} failed to load: ${loadError}`)
        await options.onRejected?.(entry.name, target)
        if (current && npm(dir, ['install', `${entry.name}@${current}`, '--save-exact']) === 0) {
            console.error(`  ${entry.name}  rolled back to ${current}`)
        } else {
            console.error(`  ${entry.name}  rollback failed; reinstall with \`battlestack plugin add ${entry.name}\``)
        }
    }
    return ok
}

/** Prints store plugins with a newer installable version; returns how many. */
export async function pluginOutdated(battlestackHome: string): Promise<number> {
    const dir = storeDir(battlestackHome)
    let outdated = 0
    for (const entry of await readStoreEntries(battlestackHome)) {
        if (entry.linked) continue
        const release = resolvePluginRelease(dir, entry.name, false)
        if (!release) {
            console.error(`  ${entry.name}  registry unreachable`)
            continue
        }
        const behind = release.target && (!entry.installed || semverLt(entry.installed, release.target))
        if (!behind) continue
        outdated++
        const latest = release.latest === release.target ? '' : ` (latest ${release.latest})`
        console.log(`  ${entry.name}  ${entry.installed ?? 'not installed'} → ${release.target}${latest}`)
    }
    if (outdated === 0) console.log('All plugins are up to date')
    return outdated
}
