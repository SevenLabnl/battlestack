/** Barrel for `./types/*.ts`, plus the contracts native to the plugin surface itself. */

import type { Ora } from 'ora'
import type { BattlestackRegistries } from './registry.js'
import type { ParsedArgs } from './types/cli.js'

export * from './types/ai-tool.js'
export * from './types/build-secret.js'
export * from './types/chat-transport.js'
export * from './types/cli.js'
export * from './types/command.js'
export * from './types/doc-section.js'
export * from './types/env.js'
export * from './types/feature.js'
export * from './types/framework.js'
export * from './types/hosts-entry.js'
export * from './types/ai-gateway.js'
export * from './types/local-state.js'
export * from './types/package-manager.js'
export * from './types/platform.js'
export * from './types/ports.js'
export * from './types/preflight.js'
export * from './types/project-manifest.js'
export * from './types/resolved-selection.js'
export * from './types/run-context.js'
export * from './types/run.js'
export * from './types/self-update.js'
export * from './types/stage.js'
export * from './types/template.js'
export * from './types/update-report.js'

/** A plugin's request to add features to a template it did not define. */
export interface TemplateExtension {
    /** Template id to extend. Skipped with a warning if no plugin defines it. */
    templateId: string
    /** Appended to `requiredFeatures`, always-on. Unregistered or ambiguous ids warn and drop. */
    addFeatures?: string[]
    /** Appended to `optionalFeatures`, user-selectable. Deduped against both lists. */
    addOptionalFeatures?: string[]
}

/** Production deploy destination, selected at scaffold time. */
export interface DeployTarget {
    id: string
    label: string
    description?: string
}

/** What a plugin-contributed command receives when the CLI dispatches to it. */
export interface CommandContext {
    /** Argv after the command name. */
    args: string[]
    /** The CLI's parsed argv. Typed access to `--force`/`--template`/… without re-parsing `args`. */
    parsed: ParsedArgs
    /** Shared spinner for long-running work (e.g. `runFeatures`). */
    loader: Ora
    /** Finalized registries: features/templates/… from every loaded plugin. */
    registries: BattlestackRegistries
}

/** A CLI subcommand contributed by a plugin. Ids are namespaced. Built-ins always win. */
export interface BattlestackCommand {
    /** Plain slug, no `:`; invoked as `battlestack <id>`. */
    id: string
    /** One-liner for `battlestack help`. */
    description: string
    /** Usage hint shown instead of the bare id, e.g. `deploy [env]`. */
    usage?: string
    run(ctx: CommandContext): Promise<void> | void
}

/** Where a contribution came from. Set by the loader, never by plugin authors. */
export interface Provenance {
    /** Full package name, e.g. `@acme/battlestack-plugin`. */
    plugin: string
    /** Short slug used as the leading segment of a fully-qualified id, e.g. `acme`. */
    namespace: string
}
