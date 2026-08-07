import type { PackageManager } from './package-manager.js'

export interface ParsedArgs {
    projectName?: string
    /** Second positional. Used by project-mode subcommands like `add <feature>` / `remove <feature>`. */
    secondPositional?: string
    /** Every positional in argv order. Used by variadic commands like `battlestack own <path...>`. */
    positionals: string[]
    framework?: string
    template?: string
    /** Comma-separated feature ids to force-enable. */
    features?: string[]
    /** Comma-separated feature ids to force-disable (must not be required). */
    disable?: string[]
    packageManager?: PackageManager
    /** Parent directory for the new project. Defaults to process.cwd(). */
    cwd?: string
    /** Bypass safety checks. On `battlestack pull`, overwrites drifted files, saving a `.bak`. */
    force: boolean
    /** Overwrite every emitted file with no `.battlestack.bak`/`.battlestack.new`/`.battlestack.patch`. Implies `force`. */
    overwrite: boolean
    /** Accept defaults for any unanswered prompt (non-interactive). */
    yes: boolean
    skipInstall: boolean
    debug: boolean
    dryRun: boolean
    help: boolean
    version: boolean
    /** Force scaffold mode even when a manifest is found in cwd. */
    scaffold: boolean
    /** Generic opt-in flag forwarded to project-mode commands (e.g. `db:fresh --seed`). */
    seed: boolean
    /** `battlestack doctor --deep`: per-feature path-level breakdown. */
    deep: boolean
    /** `--verbose` / `-V`: per-feature spinner lines + planning traces. */
    verbose: boolean
    /** Tri-state: undefined = default off, true = `--gateway`, false = `--no-gateway`. */
    gateway?: boolean
    /** Drop docker volumes when used with `battlestack down` / `battlestack db:down`. */
    volumes: boolean
    /** Auto-open URLs in the OS browser. Default on; `--no-browser` prints the URL only. */
    browser: boolean
    /** `battlestack pull`: install/refresh AI-agent skills. Default on; `--no-skills` skips that section. */
    skills: boolean
    /** `battlestack pull`: run the trailing format pass. Default on; `--no-format` skips it. */
    format: boolean
    /** `battlestack pull`: refresh ONLY the AI-agent skills; skip feature updates, deps, and formatting. */
    skillsOnly: boolean
    /** Argv after `--`, forwarded verbatim to a subcommand's underlying tool. */
    passthrough: string[]
}

export type HelpMode = 'scaffold' | 'project'
