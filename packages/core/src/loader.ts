import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { applyPlugin, finalizeRegistries, type LoadedPlugin, type BattlestackPlugin } from './plugin.js'
import { BattlestackRegistries } from './registry.js'
import { getUiPort } from './ui-port.js'

/** A plugin-store dependency named like this is loaded. `pluginAdd` rejects install-time misses. */
export const PLUGIN_NAME_RE = /^(@[^/]+\/)?battlestack-(plugin|preset)(-|$)/

export interface PluginSource {
    /** Package name, absolute path, or `file:` URL. */
    specifier: string
    via: 'bundled' | 'env' | 'project' | 'store'
    /** A broken required source throws. A broken discovered one warns and skips. */
    required: boolean
    /** Directory to resolve bare package names from. */
    basedir?: string
}

export interface DiscoverOptions {
    /** Package names shipped with the CLI, resolved from the CLI's own deps. */
    bundled: string[]
    /** Resolution root for bundled names (the CLI package's file URL or path). */
    bundledBasedir: string
    /** Battlestack home dir, default `~/.battlestack`. The plugin store lives at `<home>/plugins`. */
    battlestackHome: string
    /** Project dir to check for `battlestack.config.json`. */
    projectDir?: string
    env?: NodeJS.ProcessEnv
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
    try {
        return JSON.parse(await readFile(file, 'utf8'))
    } catch {
        return null
    }
}

/** Precedence order env > project > store > bundled. First occurrence of a name wins. */
export async function discoverPlugins(opts: DiscoverOptions): Promise<PluginSource[]> {
    const sources: PluginSource[] = []

    for (const spec of (opts.env ?? process.env).BATTLESTACK_PLUGINS?.split(',') ?? []) {
        const specifier = spec.trim()
        if (specifier) sources.push({ specifier, via: 'env', required: true, basedir: process.cwd() })
    }

    if (opts.projectDir) {
        const config = await readJson(path.join(opts.projectDir, 'battlestack.config.json'))
        for (const name of (config?.plugins as string[] | undefined) ?? []) {
            sources.push({ specifier: name, via: 'project', required: true, basedir: opts.projectDir })
        }
    }

    const storeDir = path.join(opts.battlestackHome, 'plugins')
    const storePkg = await readJson(path.join(storeDir, 'package.json'))
    const storeDeps = (storePkg?.dependencies as Record<string, string> | undefined) ?? {}
    for (const [name, version] of Object.entries(storeDeps)) {
        if (!PLUGIN_NAME_RE.test(name)) {
            getUiPort().warn(
                `Plugin store entry "${name}" doesn't match the required naming convention `
                + '("battlestack-plugin*" / "battlestack-preset*", optionally scoped, e.g. '
                + `"@scope/battlestack-plugin-foo"); skipping, it will never load. Remove it with `
                + `"battlestack plugin remove ${name}" or rename the package.`,
            )
            continue
        }
        // `file:` deps resolve by path, registry installs by name.
        const specifier = version.startsWith('file:') ? version : name
        sources.push({ specifier, via: 'store', required: false, basedir: storeDir })
    }

    for (const name of opts.bundled) {
        sources.push({ specifier: name, via: 'bundled', required: true, basedir: opts.bundledBasedir })
    }

    const seen = new Set<string>()
    return sources.filter((s) => (seen.has(s.specifier) ? false : (seen.add(s.specifier), true)))
}

async function resolveEntry(src: PluginSource): Promise<URL> {
    let spec = src.specifier
    if (spec.startsWith('file:')) spec = spec.slice('file:'.length)

    if (path.isAbsolute(spec)) {
        // Directory path → honor the package.json entry point.
        const pkg = await readJson(path.join(spec, 'package.json'))
        const exportsField = pkg?.exports as Record<string, string> | string | undefined
        const entry
            = typeof exportsField === 'string' ? exportsField
                : exportsField?.['.'] ?? (pkg?.main as string | undefined) ?? 'index.js'
        return pathToFileURL(path.join(spec, entry))
    }

    const require = createRequire(path.join(src.basedir ?? process.cwd(), 'noop.js'))
    return pathToFileURL(require.resolve(spec))
}

export interface LoadResult {
    registries: BattlestackRegistries
    plugins: LoadedPlugin[]
    /** Discovered-but-broken plugins, reported by `battlestack doctor` / `battlestack plugins`. */
    skipped: Array<{ specifier: string; via: string; error: string }>
    /** Non-fatal template-extension issues (unknown template / unregistered feature). */
    warnings: string[]
}

export async function loadPlugins(sources: PluginSource[]): Promise<LoadResult> {
    const registries = new BattlestackRegistries()
    const result: LoadResult = { registries, plugins: [], skipped: [], warnings: [] }

    for (const src of sources) {
        try {
            const mod = (await import((await resolveEntry(src)).href)) as { default?: BattlestackPlugin }
            if (typeof mod.default?.register !== 'function') {
                throw new Error('default export is not a battlestack plugin (use defineBattlestackPlugin)')
            }
            result.plugins.push(applyPlugin(mod.default, src.via, registries))
        } catch (err) {
            if (src.required) throw err
            result.skipped.push({
                specifier: src.specifier,
                via: src.via,
                error: err instanceof Error ? err.message : String(err),
            })
        }
    }

    result.warnings = finalizeRegistries(
        registries,
        result.plugins.flatMap((p) => p.extensions),
    )
    return result
}
