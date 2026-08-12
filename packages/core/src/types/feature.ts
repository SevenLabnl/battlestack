import type { RunContext } from './run-context.js'
import type { EnvVar } from './env.js'
import type { DocSection } from './doc-section.js'
import type { BuildSecret } from './build-secret.js'
import type { ProjectCommand } from './command.js'
import type { UpdateReport } from './update-report.js'
import type { Stage } from './stage.js'
import type { ProjectManifest } from './project-manifest.js'
import type { ChatTransport } from './chat-transport.js'
import type { PackageManager } from './package-manager.js'

export interface FeatureDeps {
    prod?: string[]
    dev?: string[]
}

export interface InstalledFeatureRecord {
    id: string
    version: string
    /** Map of relative file path → content hash at install time. */
    files: Record<string, string>
    /** Paths the user owns; `battlestack pull` skips them entirely. */
    ownedByUser?: string[]
    /** Free-form state recorded by the feature for later migrations. */
    state?: Record<string, unknown>
}

/** A unit of work contributing to the scaffolded project. */
export interface Feature {
    id: string
    /** Short label shown in prompts / logs. */
    label: string
    /** One-line detail shown when highlighted in multiselect prompts. */
    description?: string
    /** Frameworks this feature supports. Omit to mark as cross-cutting. */
    frameworks?: string[]
    /** Coarse install slot. See `STAGE_ORDER` in `../constants/stages.js`. */
    stage: Stage
    /** Fine ordering inside a stage. Stage order wins on conflict. */
    before?: string[]
    after?: string[]
    /** Semver. Bump when emitted output changes so upgrade can detect drift. */
    version: string
    /** Other feature ids that must run before this one. */
    requires?: string[]
    /** When true, failures log a warning instead of aborting the run. */
    failureIsNonFatal?: boolean
    /** Whether this feature can be re-applied via `battlestack pull`. Default `true`. */
    upgradable?: boolean
    /** Aggregated upfront so a single install pass covers all selected features. */
    collectDeps?(ctx: RunContext): FeatureDeps | null | undefined
    /** Framework-native module identifiers (fed to `nuxi init --modules`). */
    collectModules?(ctx: RunContext): string[] | null | undefined
    /** Skill sources installed once by `shared:install`. Enabled features only. */
    collectSkills?(ctx: RunContext): string[] | null | undefined
    /** Project-mode commands merged into the global command table. */
    projectCommands?(ctx: RunContext): Record<string, ProjectCommand> | null | undefined
    /** Idempotent maintenance hook. Runs before every project-mode command. */
    preCheck?(ctx: RunContext): Promise<void>
    /** Aggregated and written by `shared:env`. Features must never write env files directly. */
    collectEnv?(ctx: RunContext): EnvVar[] | null | undefined
    /** Doc contributions aggregated by `nuxt4:docs`. */
    collectDocs?(ctx: RunContext): DocSection[] | null | undefined
    /** Docker build-time secrets aggregated by `shared:docker` (BuildKit `--mount=type=secret`). */
    collectBuildSecrets?(ctx: RunContext): BuildSecret[] | null | undefined
    /** Paths to mark as `ownedByUser` at scaffold time. */
    structuralFiles?(ctx: RunContext): string[]
    /** Feature-specific follow-up prompts at scaffold. MUST self-bypass under non-interactive runs. */
    prompt?(ctx: RunContext): Promise<void>
    /** Initial install; runs during scaffold. */
    execute(ctx: RunContext): Promise<void>
    /** Idempotent re-run for an existing project. */
    update?(ctx: RunContext, prev: InstalledFeatureRecord | null): Promise<UpdateReport>
}

/** Shared state passed through `RunContext.state`. Populates incrementally; all keys optional. */
export interface FeatureState {
    // CLI-side choices (set by `battlestack create` / args parser)
    packageManager?: PackageManager
    skipInstall?: boolean
    gatewayEnabled?: boolean
    nonInteractive?: boolean
    /** Mirror of `--verbose` / `-V`. */
    verbose?: boolean
    force?: boolean
    /** `battlestack pull --overwrite`: overwrite every emitted file, staging no artifacts. */
    overwrite?: boolean
    seed?: boolean
    /** `battlestack down -v` / `--volumes`: drop docker volumes when stopping. */
    volumes?: boolean
    /** Anything after `--` on the CLI, forwarded to a subcommand's underlying tool. */
    passthrough?: string[]
    /** First positional after the subcommand name (e.g. `battlestack login foo@example.com` → `foo@example.com`). */
    subcommandArg?: string
    /** Auto-open browser. Default on; `--no-browser` prints the URL only (SSH-friendly). */
    browser?: boolean
    nuxiTemplate?: string

    // Cross-feature shared values
    adminEmail?: string
    adminPassword?: string
    aiTool?: string
    chatTransport?: ChatTransport
    minReleaseAgeDays?: number
    policies?: ProjectManifest['policies']
    storageRegion?: string

    // AI gateway / Mastra prompt answers. The gateway is any OpenAI-compatible
    // proxy; `sluis` is the only named preset, `custom` covers everything else
    // (a LiteLLM proxy, a vendor's own compatible endpoint, ...).
    aiGatewayPreset?: 'sluis' | 'custom'
    aiGatewayUrl?: string
    aiGatewayKey?: string
    aiGatewayChatModel?: string
    aiGatewayEmbeddingModels?: string[]

    // RAG prompt answers
    ragEmbeddingModel?: string
    ragDimensions?: number
    ragChunkSize?: number
    ragChunkOverlap?: number
    ragChunkingStrategy?: string
    ragTopK?: number

    /** Deploy target id or fqid, resolved against `BattlestackRegistries.deployTargets`. */
    deployTarget?: string

    // Per-feature file-ownership maps live under `files:<featureId>` keys.
    // Bare keys are core's namespace. Feature-private state uses a namespaced key.
    [key: string]: unknown
}
