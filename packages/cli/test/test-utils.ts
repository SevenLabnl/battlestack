import { vi } from 'vitest'
import {
    applyPlugin,
    BattlestackRegistries,
    defineBattlestackPlugin,
    finalizeRegistries,
    type Feature,
    type Framework,
    type ParsedArgs,
    type Template,
    type TemplateExtension,
} from '@battlestack/core'

/**
 * Shared `ParsedArgs` builder for CLI command tests. Every field defaults to its
 * flag-off value; pass `overrides` for the ones a test cares about.
 */
export function defaultArgs(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
    return {
        force: false,
        overwrite: false,
        yes: false,
        skipInstall: false,
        debug: false,
        dryRun: false,
        help: false,
        version: false,
        scaffold: false,
        seed: false,
        deep: false,
        verbose: false,
        volumes: false,
        browser: true,
        skills: true,
        format: true,
        skillsOnly: false,
        positionals: [],
        passthrough: [],
        ...overrides,
    }
}

/** One plugin's worth of contributions for {@link buildRegistries}. */
export interface PluginSpec {
    /** Package name. Defaults to `@test/<namespace>`. */
    name?: string
    /** Leading fqid segment. Every id this spec contributes ends up under it. */
    namespace: string
    frameworks?: Framework[]
    features?: Feature[]
    templates?: Template[]
    extensions?: TemplateExtension[]
}

/**
 * Build registries as production does. Never `register()` directly: it skips finalization
 * and leaves bare == fqid, which is how past id bugs shipped behind a green suite.
 */
export function buildRegistries(...specs: PluginSpec[]): {
    registries: BattlestackRegistries
    /** `finalizeRegistries`'s non-fatal warnings: an unexpected one is a real signal. */
    warnings: string[]
} {
    const registries = new BattlestackRegistries()
    const extensions = specs.flatMap((spec) =>
        applyPlugin(
            defineBattlestackPlugin({
                name: spec.name ?? `@test/${spec.namespace}`,
                apiVersion: 1,
                namespace: spec.namespace,
                register(battlestack) {
                    for (const f of spec.frameworks ?? []) battlestack.addFramework(f)
                    for (const f of spec.features ?? []) battlestack.addFeature(f)
                    for (const t of spec.templates ?? []) battlestack.addTemplate(t)
                    for (const e of spec.extensions ?? []) battlestack.extendTemplate(e)
                },
            }),
            'bundled',
            registries,
        ).extensions,
    )
    // Extensions are collected across ALL plugins before finalizing, so they stay
    // load-order-independent: the same second pass the loader runs.
    return { registries, warnings: finalizeRegistries(registries, extensions) }
}

/**
 * Run `fn` with `process.cwd()` at `dir`, restoring it even on throw, since commands
 * resolve their project root from cwd. Silences `console.log` for the duration.
 */
export async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
    const orig = process.cwd()
    process.chdir(dir)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
        return await fn()
    } finally {
        log.mockRestore()
        process.chdir(orig)
    }
}

/** Same as {@link withCwd}, but collects the `console.log` lines instead of discarding them. */
export async function withCwdCapture(dir: string, fn: () => Promise<void>): Promise<string[]> {
    const orig = process.cwd()
    process.chdir(dir)
    const lines: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
        lines.push(a.join(' '))
    })
    try {
        await fn()
        return lines
    } finally {
        log.mockRestore()
        process.chdir(orig)
    }
}
