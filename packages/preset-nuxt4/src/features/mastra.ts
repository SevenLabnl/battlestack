import path from 'node:path'
import os from 'node:os'
import { rm } from 'node:fs/promises'
import prompts from 'prompts'
import { ui } from '@battlestack/tui'
import { emitTemplate, emitTemplateUpdateMany } from '../utils/emit-template.js'
import { patchNuxtConfig } from '../utils/nuxt-config.js'
import { describeGatewayError, fetchGatewayModelsDetailed } from '@battlestack/core/utils/ai-gateway.js'
import { readDotEnv } from '@battlestack/core/utils/dotenv.js'
import {
    readJson,
    writeJson,
    writeFileEnsured,
    allocatePort,
    run,
    resolveProjectPM,
    isFeatureEnabled,
    STAGE,
} from '@battlestack/core'
import type { EnvVar, Feature, ProjectCommand, RunContext } from '@battlestack/core'
import {
    DEFAULT_EMBEDDING_MODEL,
    DEFAULT_GATEWAY_PRESET,
    FALLBACK_CHAT_MODEL,
    GATEWAY_PRESETS,
    presetChatModel,
} from '@battlestack/core/constants/ai.js'

/** Mastra AI runtime. Talks to an OpenAI-compatible AI gateway (sluis.ai preset, or any compatible URL) via `@ai-sdk/openai-compatible`. */
export const mastraFeature: Feature = {
    id: 'nuxt4:mastra',
    version: '2.1.0',
    label: 'Mastra AI runtime',
    frameworks: ['nuxt4'],
    stage: STAGE.AI_CORE,
    failureIsNonFatal: true,
    requires: ['nuxt4:database'],

    collectDeps() {
        return {
            prod: [
                '@mastra/core',
                '@mastra/ai-sdk',
                '@mastra/loggers',
                '@mastra/observability',
                '@mastra/pg',
                '@ai-sdk/openai-compatible',
                '@ai-sdk/provider',
                '@ai-sdk/vue',
                'ai',
                // Root aliases, forcing in npm-aliased deps Nitro's tracer cannot copy.
                '@ai-sdk/provider-utils-v5@npm:@ai-sdk/provider-utils@^3',
                'zod-from-json-schema-v3@npm:zod-from-json-schema@^0.0.5',
            ],
            // Dev-only: the `mastra` CLI ships Mastra Studio and is never imported by the build.
            dev: ['mastra'],
        }
    },

    // Installed by `shared:install` while this feature is enabled.
    collectSkills() {
        return ['mastra-ai/skills']
    },

    async prompt(ctx) {
        if (ctx.state.nonInteractive === true) return

        ui.section('AI gateway')
        ui.dim('  AI features talk to an OpenAI-compatible AI gateway.')

        const { preset } = await prompts({
            type: 'select',
            name: 'preset',
            message: 'AI gateway',
            choices: [
                { title: GATEWAY_PRESETS.sluis.label, value: 'sluis' },
                { title: GATEWAY_PRESETS.custom.label, value: 'custom' },
            ],
            initial: ctx.state.aiGatewayPreset === 'custom' ? 1 : 0,
        })
        if (preset === 'sluis' || preset === 'custom') ctx.state.aiGatewayPreset = preset
        // Strict equality: an ESC-cancelled select must not silently become the
        // hosted preset (and prefill an external URL the user never chose).
        const isSluis = ctx.state.aiGatewayPreset === 'sluis'

        // The sluis preset prefills its hosted URL (still editable); custom
        // requires one — `validate` refuses anything that isn't http(s).
        const { url } = await prompts({
            type: 'text',
            name: 'url',
            message: 'Gateway URL',
            initial: ctx.state.aiGatewayUrl ?? (isSluis ? GATEWAY_PRESETS.sluis.url : undefined),
            validate: (v: string) => v.startsWith('http') || 'Must be http(s) URL',
        })
        if (typeof url === 'string') ctx.state.aiGatewayUrl = url.trim()

        const { key } = await prompts({
            type: 'password',
            name: 'key',
            message: isSluis
                ? 'sluis.ai API key (sk_live_..., optional, leave blank to set later in .env)'
                : 'Gateway API key (optional, leave blank to set later in .env)',
        })
        const trimmedKey = ((key as string | undefined) ?? '').trim()
        if (trimmedKey) ctx.state.aiGatewayKey = trimmedKey

        const gatewayLabel = isSluis ? 'sluis.ai' : 'AI gateway'
        let chatChoices: string[] = []
        if (trimmedKey) {
            ui.dim('  Fetching available models…')
            const { models, error } = await fetchGatewayModelsDetailed(
                trimmedKey,
                ctx.state.aiGatewayUrl ?? '',
            )
            // fetchGatewayModelsDetailed guarantees models XOR error, and non-null
            // models always carry at least one id, so two branches cover everything.
            if (models) {
                ui.ok(
                    `${models.chat.length} chat models, ${models.embedding.length} embedding models`,
                )
                ctx.state.aiGatewayEmbeddingModels = models.embedding
                chatChoices = models.chat
            } else {
                ui.warn(describeGatewayError(error!, gatewayLabel))
            }
        }

        const pinned = presetChatModel(ctx.state.aiGatewayPreset)
        if (pinned) {
            // A named preset ships a known catalogue, so the scaffold pins its alias
            // instead of a vendor model id. Still editable in `.env` later.
            ctx.state.aiGatewayChatModel = pinned
            ui.dim(`  Chat model: ${pinned} (gateway alias, change in .env)`)
        } else {
            // A custom gateway has no known-good default, so the user must name a
            // model themselves: picked from the live-pulled list when a key was
            // given, typed freely otherwise. No hardcoded vendor fallback.
            const useAutocomplete = chatChoices.length > 0
            const { chatModel } = await prompts({
                type: useAutocomplete ? 'autocomplete' : 'text',
                name: 'chatModel',
                message: useAutocomplete
                    ? 'Chat model'
                    : 'Chat model name (no gateway fetch, type freely)',
                choices: useAutocomplete
                    ? chatChoices.map((m) => ({ title: m, value: m }))
                    : undefined,
                validate: useAutocomplete
                    ? undefined
                    : (v: string) => v.trim().length > 0 || 'A model id is required',
                suggest: useAutocomplete
                    ? (input: string, choices: Array<{ title: string }>) =>
                            Promise.resolve(
                                choices.filter((c) =>
                                    c.title.toLowerCase().includes(input.toLowerCase()),
                                ),
                            )
                    : undefined,
            })
            if (typeof chatModel === 'string' && chatModel.trim()) {
                ctx.state.aiGatewayChatModel = chatModel.trim()
            }
        }
    },

    collectEnv(ctx): EnvVar[] {
        // A non-interactive scaffold leaves the URL blank; the sluis.ai preset
        // fills it during the prompt.
        const url = ctx.state.aiGatewayUrl ?? ''
        const key = ctx.state.aiGatewayKey
        // Falls back to the preset's own alias, never across presets: a `custom`
        // gateway that never reached the model prompt (ESC) gets a blank value to
        // fill in, not another gateway's model id it would 404 on.
        const chatModel
            = ctx.state.aiGatewayChatModel
                ?? presetChatModel(ctx.state.aiGatewayPreset ?? DEFAULT_GATEWAY_PRESET)
                ?? ''
        const embeddingModel
            = ctx.state.ragEmbeddingModel ?? DEFAULT_EMBEDDING_MODEL
        return [
            {
                key: 'NUXT_AI_GATEWAY_URL',
                value: url,
                example: GATEWAY_PRESETS.sluis.url,
                group: 'AI',
                description: 'OpenAI-compatible AI gateway base URL: sluis.ai, a self-hosted '
                    + 'LiteLLM proxy, or any compatible endpoint. Mastra calls it via '
                    + '@ai-sdk/openai-compatible. Required before AI features will work.',
            },
            {
                key: 'NUXT_AI_GATEWAY_KEY',
                value: key ?? '',
                example: 'sk_live_replace_me',
                group: 'AI',
                secret: true,
                description: 'AI gateway API key (sluis.ai keys look like sk_live_...).',
            },
            {
                key: 'NUXT_AI_GATEWAY_CHAT_MODEL',
                value: chatModel,
                // A sluis alias is a useless placeholder for a gateway that cannot serve it.
                example: presetChatModel(ctx.state.aiGatewayPreset) ?? FALLBACK_CHAT_MODEL,
                group: 'AI',
                description: 'Default chat model id served by the gateway, in the '
                    + '`<provider>/<model>` form the router requires. Required before '
                    + 'AI features will work.',
            },
            {
                key: 'NUXT_AI_GATEWAY_EMBEDDING_MODEL',
                value: embeddingModel,
                group: 'AI',
                description: 'Default embedding model id (used by RAG).',
            },
            {
                key: 'NUXT_AI_GATEWAY_HEADERS',
                value: '',
                group: 'AI',
                description: 'Optional JSON object of extra request headers, e.g. '
                    + '{"X-Sluis-Residency":"eu-only"} for a per-request sluis.ai '
                    + 'residency override.',
            },
        ]
    },

    collectDocs(ctx) {
        // The gateway blurb reflects what THIS project was scaffolded with, so the AI
        // tools reading these docs don't act on the wrong provider or key format.
        const gatewayBlurb = ctx.state.aiGatewayPreset === 'custom'
            ? 'The gateway is configured with `NUXT_AI_GATEWAY_URL` + `NUXT_AI_GATEWAY_KEY` in `.env`'
                + (ctx.state.aiGatewayUrl ? ` (this project: \`${ctx.state.aiGatewayUrl}\`)` : '')
                + '. Any OpenAI-compatible endpoint works — a self-hosted LiteLLM proxy, a vendor gateway, or [sluis.ai](https://sluis.ai). Gateway-specific request headers go in `NUXT_AI_GATEWAY_HEADERS` (JSON object).'
            : 'The gateway is configured with `NUXT_AI_GATEWAY_URL` + `NUXT_AI_GATEWAY_KEY` in `.env`. This project uses the [sluis.ai](https://sluis.ai) preset: hosted, EU data residency, PII redaction, tamper-evident audit ledger; keys look like `sk_live_...`; per-request residency override via `NUXT_AI_GATEWAY_HEADERS`, e.g. `{"X-Sluis-Residency":"eu-only"}`. Any other OpenAI-compatible endpoint also works by swapping the URL.'
        return [
            {
                heading: 'AI (Mastra)',
                body: [
                    'Mastra is the default AI runtime. The OpenAI SDK is **not** a direct dependency; Mastra talks to an OpenAI-compatible AI gateway via `@ai-sdk/openai-compatible`.',
                    '',
                    gatewayBlurb,
                    '',
                    '- Runtime: `server/mastra/index.ts`',
                    '- Default agent: `server/mastra/agents/default.ts`',
                    '- Add agents/tools/workflows to the Mastra constructor in `index.ts`',
                    '- Swap models by editing the agent (no code path change)',
                    '',
                    'Admins also swap models at runtime from `/dashboard/settings/ai`. The `ai_model_configs` table holds `chat` + `embedding` rows; agents resolve a `key` and use the row\'s `model` value. The page calls `/api/ai/models` (gateway passthrough) for the picker and `PUT /api/ai/configs/:id` to commit changes (admin-only, audit-logged).',
                    '',
                    'Boot-time registration: `server/plugins/10-sync-ai-on-boot.ts` runs on EVERY boot (dev/staging/prod, advisory-locked) and ensures the `ai_model_configs` rows plus an `agents` row per registered agent exist: insert-if-missing, never update or delete. This replaces relying on the dev-only `db:seed` (which refuses to run in production), so a fresh staging/prod deploy is never left with empty tables.',
                    '',
                    'The `agents` table links each agent to a model config and (optionally) a prompt BY KEY: `model_config_key` → `ai_model_configs.key`, `prompt_key` → `prompts.key` (nullable: an agent can have no prompt, and a prompt can have no agent). Agents resolve both per-call via `getAgentModelId(key)` / `getAgentInstructions(key)` (`server/mastra/utils/agent-runtime.ts`), falling back to env / code defaults when a row, prompt, or the prompts table is absent. Admins repoint the model or swap the prompt from `/dashboard/settings/ai` (`/api/ai/agents` + `PUT /api/ai/agents/:id`). Declare agent metadata (name, default model config + prompt) in `server/mastra/agents/registry.ts`.',
                    '',
                    'Chat and RAG features both build on this runtime. Their endpoints call `mastra.getAgent(...)` rather than instantiating their own clients.',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute(ctx) {
        await emitTemplate(ctx, 'nuxt4:mastra', import.meta.url, 'mastra')
        await patchBundling(ctx.projectDir)
        await emitStudioBundlerConfig(ctx)
        await addStudioScript(ctx)

        // The admin CRUD page needs `admin` middleware from `nuxt4:user-admin`.
        if (isFeatureEnabled(ctx, 'nuxt4:user-admin')) {
            await emitTemplate(ctx, 'nuxt4:mastra', import.meta.url, 'mastra-admin')
            await flagMastraAdminEnabled(ctx.projectDir)
        }
    },

    async update(ctx, prev) {
        const subtrees = isFeatureEnabled(ctx, 'nuxt4:user-admin')
            ? ['mastra', 'mastra-admin']
            : ['mastra']
        const result = await emitTemplateUpdateMany(ctx, 'nuxt4:mastra', import.meta.url, subtrees, prev)
        await patchBundling(ctx.projectDir)
        await emitStudioBundlerConfig(ctx)
        await addStudioScript(ctx)
        if (isFeatureEnabled(ctx, 'nuxt4:user-admin')) {
            await flagMastraAdminEnabled(ctx.projectDir)
        }
        return result
    },

    projectCommands(): Record<string, ProjectCommand> {
        const studioRun = async (ctx: RunContext): Promise<void> => {
            const port = allocatePort(ctx.projectName, 'mastra-studio')
            const pm = await resolveProjectPM({
                projectDir: ctx.projectDir,
                fallback: String(ctx.state.packageManager ?? 'pnpm'),
            })
            // Wipes the hour-long gateway-registry cache.
            await clearMastraGatewayCache()
            const studioUrl = ui.color.accent(`http://localhost:${port}`)
            ui.ok(`Mastra Studio → ${studioUrl}  ${ui.color.dim('(dev-only, do not run in prod)')}`)
            // `mastra dev` does not load `.env`, so NUXT_AI_GATEWAY_* is passed through explicitly.
            const env: Record<string, string> = {}
            for (const [k, v] of await readDotEnv(ctx.projectDir)) env[k] = v
            env.PORT = String(port)
            // `mastra dev` reads PORT from env, defaulting to 4111.
            await run(pm, ['exec', 'mastra', 'dev', '--dir', 'server/mastra'], {
                cwd: ctx.projectDir,
                inherit: true,
                env,
            })
        }
        return {
            'mastra:studio': { label: 'Start Mastra Studio (dev only)', run: studioRun },
        }
    },
}

// `GatewayRegistry` caches at `~/.cache/mastra/` and re-syncs hourly.
async function clearMastraGatewayCache(): Promise<void> {
    const cacheDir = path.join(os.homedir(), '.cache', 'mastra')
    for (const f of ['provider-registry.json', 'gateway-refresh-time']) {
        try {
            await rm(path.join(cacheDir, f), { force: true })
        } catch {
            // Best-effort.
        }
    }
}

// Empty bundler config, which the Mastra CLI requires to exist.
async function emitStudioBundlerConfig(ctx: RunContext): Promise<void> {
    const dest = path.join(ctx.projectDir, '.mastra', 'bundler-config.mjs')
    await writeFileEnsured(dest, 'const bundler = {};\n\nexport { bundler };\n')
}

// `pnpm run mastra:dev` mirrors `battlestack mastra:dev`. The port is fixed at scaffold time.
async function addStudioScript(ctx: RunContext): Promise<void> {
    const port = allocatePort(ctx.projectName, 'mastra-studio')
    const pkgPath = path.join(ctx.projectDir, 'package.json')
    const pkg = await readJson<Record<string, unknown>>(pkgPath)
    const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {}
    scripts['mastra:studio'] = `PORT=${port} mastra dev --dir server/mastra`
    pkg.scripts = scripts
    await writeJson(pkgPath, pkg)
}

// Registers the runtimeConfig keys NUXT_AI_GATEWAY_* binds onto.
async function patchBundling(projectDir: string): Promise<void> {
    await patchNuxtConfig(projectDir, (c) => {
        c.mergeRuntimeConfig({
            aiGatewayUrl: '',
            aiGatewayKey: '',
        })
    })
}

// Runtime flag gating the dashboard layout's "AI settings" nav entry.
async function flagMastraAdminEnabled(projectDir: string): Promise<void> {
    await patchNuxtConfig(projectDir, (c) => c.mergeRuntimePublic({ mastraAdmin: true }))
}
