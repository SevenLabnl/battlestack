import path from 'node:path'
import { writeFile as fsWriteFile } from 'node:fs/promises'
import { generateCode, loadFile } from 'magicast'
import { defaultObject, mergeShallow, pushUnique, pushUniqueAll } from '@battlestack/core/utils/ts-file.js'

type Mod = Awaited<ReturnType<typeof loadFile>>

export class NuxtConfig {
    private readonly mod: Mod
    private readonly filePath: string

    private constructor(mod: Mod, filePath: string) {
        this.mod = mod
        this.filePath = filePath
    }

    static async load(projectDir: string): Promise<NuxtConfig> {
        const cfgPath = path.join(projectDir, 'nuxt.config.ts')
        const mod = await loadFile(cfgPath)
        return new NuxtConfig(mod, cfgPath)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private get config(): any {
        return defaultObject(this.mod)
    }

    addModule(name: string): this {
        this.config.modules ||= []
        pushUnique(this.config.modules, name)
        return this
    }

    addCss(entry: string): this {
        this.config.css ||= []
        pushUnique(this.config.css, entry)
        return this
    }

    /**
     * Append a `<link>` to `app.head.link`. Idempotent on rel+href.
     *
     * The `[...links]` spread is load-bearing: array methods called straight on a
     * magicast proxy scan the AST node, not the elements, and `.some()` there returns
     * false for entries that are plainly present. `pushUnique` in `ts-file.ts` spreads
     * for the same reason.
     */
    addHeadLink(link: Record<string, string>): this {
        this.config.app ||= {}
        this.config.app.head ||= {}
        this.config.app.head.link ||= []
        const links = this.config.app.head.link
        const already = [...links].some(
            (l: Record<string, string>) => l.rel === link.rel && l.href === link.href,
        )
        if (!already) links.push(link)
        return this
    }

    /** Append a `<meta>` to `app.head.meta`. Idempotent on name. See `addHeadLink` re: the spread. */
    addHeadMeta(meta: Record<string, string>): this {
        this.config.app ||= {}
        this.config.app.head ||= {}
        this.config.app.head.meta ||= []
        const metas = this.config.app.head.meta
        const already = [...metas].some((m: Record<string, string>) => m.name === meta.name)
        if (!already) metas.push(meta)
        return this
    }

    addViteOptimizeIncludes(entries: string[]): this {
        this.config.vite ||= {}
        this.config.vite.optimizeDeps ||= {}
        this.config.vite.optimizeDeps.include ||= []
        pushUniqueAll(this.config.vite.optimizeDeps.include, entries)
        return this
    }

    /** Force Vite SSR to bundle a dep rather than externalize it. */
    addViteSsrNoExternal(entries: string[]): this {
        this.config.vite ||= {}
        this.config.vite.ssr ||= {}
        this.config.vite.ssr.noExternal ||= []
        pushUniqueAll(this.config.vite.ssr.noExternal, entries)
        return this
    }

    /** Forces Nitro to inline-bundle a package rather than leave a runtime `node_modules/` import. */
    addNitroInlineExternals(entries: string[]): this {
        this.config.nitro ||= {}
        const nitro = this.config.nitro as Record<string, unknown>
        nitro.externals ||= {}
        const externals = nitro.externals as Record<string, unknown>
        externals.inline ||= []
        pushUniqueAll(externals.inline as string[], entries)
        return this
    }

    /** Extra Host headers for Vite's anti-DNS-rebinding check. `.battlestack.test` matches the subdomain. */
    addViteAllowedHosts(entries: string[]): this {
        this.config.vite ||= {}
        this.config.vite.server ||= {}
        this.config.vite.server.allowedHosts ||= []
        pushUniqueAll(this.config.vite.server.allowedHosts, entries)
        return this
    }

    mergeRuntimeConfig(patch: Record<string, unknown>): this {
        mergeShallow(this.config, 'runtimeConfig', patch)
        return this
    }

    mergeRuntimePublic(patch: Record<string, unknown>): this {
        this.config.runtimeConfig ||= {}
        mergeShallow(this.config.runtimeConfig, 'public', patch)
        return this
    }

    /** Sets a `runtimeConfig.public` key only when absent, never clobbering a user value. */
    setRuntimePublicDefault(key: string, value: unknown): this {
        this.config.runtimeConfig ||= {}
        this.config.runtimeConfig.public ||= {}
        if (this.config.runtimeConfig.public[key] == null) {
            this.config.runtimeConfig.public[key] = value
        }
        return this
    }

    /** Append a JSON file to `i18n.locales[code].files`. Idempotent. */
    addI18nLocaleFile(code: string, file: string): this {
        this.config.i18n ||= {}
        this.config.i18n.locales ||= []
        const locales = this.config.i18n.locales as Array<Record<string, unknown>>
        let entry = locales.find((l) => l.code === code) as
            | { code: string, files?: string[] }
            | undefined
        if (!entry) {
            entry = { code }
            locales.push(entry as unknown as Record<string, unknown>)
        }
        entry.files ||= []
        if (!entry.files.includes(file)) entry.files.push(file)
        return this
    }

    /** Deep-merge a partial Nitro config into `nitro`. */
    setNitro(nitro: Record<string, unknown>): this {
        this.config.nitro ||= {}
        deepMergeInto(this.config.nitro, nitro)
        return this
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutate(fn: (config: any) => void): this {
        fn(this.config)
        return this
    }

    async save(): Promise<void> {
        // Matches the project's ESLint style: single quotes, indent 4.
        const { code } = generateCode(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.mod as any,
            { quote: 'single', tabWidth: 4 },
        )
        const withTrailingNewline = code.endsWith('\n') ? code : code + '\n'
        await fsWriteFile(this.filePath, withTrailingNewline, 'utf8')
    }
}

export async function patchNuxtConfig(
    projectDir: string,
    fn: (cfg: NuxtConfig) => unknown,
): Promise<void> {
    const cfg = await NuxtConfig.load(projectDir)
    await fn(cfg)
    await cfg.save()
}

// Arrays are replaced wholesale (no concat).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMergeInto(target: any, source: any): void {
    if (!isPlainObject(target) || !isPlainObject(source)) return
    for (const [key, value] of Object.entries(source)) {
        if (isPlainObject(value)) {
            if (!isPlainObject(target[key])) target[key] = {}
            deepMergeInto(target[key], value)
        } else {
            target[key] = value
        }
    }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v)
}
