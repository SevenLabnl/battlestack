import path from 'node:path'
import os from 'node:os'
import { rm } from 'node:fs/promises'
import prompts from 'prompts'
import { ui } from '@battlestack/tui'
import { emitTemplate, emitTemplateUpdateMany } from '../utils/emit-template.js'
import { patchNuxtConfig } from '../utils/nuxt-config.js'
import { describeLiteLLMError, fetchLiteLLMModelsDetailed } from '@battlestack/core/utils/litellm.js'
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
    DEFAULT_CHAT_MODEL,
    DEFAULT_EMBEDDING_MODEL,
} from '@battlestack/core/constants/ai.js'

/** Mastra AI runtime. Talks to LiteLLM via `@ai-sdk/openai-compatible`. */
export const mastraFeature: Feature = {
    id: 'nuxt4:mastra',
    version: '1.2.0',
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

        ui.section('AI / LiteLLM')
        ui.dim('  AI features talk to a LiteLLM proxy (OpenAI-compatible).')

        // No default. `validate` requires the user to supply a proxy URL.
        const { url } = await prompts({
            type: 'text',
            name: 'url',
            message: 'LiteLLM proxy URL',
            initial: ctx.state.litellmUrl,
            validate: (v: string) => v.startsWith('http') || 'Must be http(s) URL',
        })
        if (typeof url === 'string') ctx.state.litellmUrl = url.trim()

        const { key } = await prompts({
            type: 'password',
            name: 'key',
            message: 'LiteLLM API key (optional, leave blank to set later in .env)',
        })
        const trimmedKey = ((key as string | undefined) ?? '').trim()
        if (trimmedKey) ctx.state.litellmKey = trimmedKey

        let chatChoices: string[] = []
        if (trimmedKey) {
            ui.dim('  Fetching available models…')
            const { models, error } = await fetchLiteLLMModelsDetailed(
                trimmedKey,
                ctx.state.litellmUrl ?? '',
            )
            if (models && (models.chat.length > 0 || models.embedding.length > 0)) {
                ui.ok(
                    `${models.chat.length} chat models, ${models.embedding.length} embedding models`,
                )
                ctx.state.litellmChatModels = models.chat
                ctx.state.litellmEmbeddingModels = models.embedding
                chatChoices = models.chat
            } else if (error) {
                ui.warn(`${describeLiteLLMError(error)}; falling back to defaults`)
            } else {
                ui.warn('LiteLLM returned no models; falling back to defaults')
            }
        }

        const useAutocomplete = chatChoices.length > 0
        const { chatModel } = await prompts({
            type: useAutocomplete ? 'autocomplete' : 'text',
            name: 'chatModel',
            message: useAutocomplete
                ? 'Chat model'
                : 'Chat model name (no proxy fetch, type freely)',
            initial: useAutocomplete ? undefined : DEFAULT_CHAT_MODEL,
            choices: useAutocomplete
                ? chatChoices.map((m) => ({ title: m, value: m }))
                : undefined,
            suggest: useAutocomplete
                ? (input: string, choices: Array<{ title: string }>) =>
                        Promise.resolve(
                            choices.filter((c) =>
                                c.title.toLowerCase().includes(input.toLowerCase()),
                            ),
                        )
                : undefined,
        })
        if (typeof chatModel === 'string') ctx.state.litellmChatModel = chatModel.trim()
    },

    collectEnv(ctx): EnvVar[] {
        // No fallback hostname. A non-interactive scaffold leaves this blank.
        const url = ctx.state.litellmUrl ?? ''
        const key = ctx.state.litellmKey
        const chatModel
            = ctx.state.litellmChatModel ?? DEFAULT_CHAT_MODEL
        const embeddingModel
            = ctx.state.ragEmbeddingModel ?? DEFAULT_EMBEDDING_MODEL
        return [
            {
                key: 'NUXT_LITELLM_URL',
                value: url,
                example: 'https://your-litellm-proxy.example/',
                group: 'AI',
                description: 'LiteLLM proxy base URL. Mastra calls it via @ai-sdk/openai. '
                    + 'Required before AI features will work; no default is shipped.',
            },
            {
                key: 'NUXT_LITELLM_KEY',
                value: key ?? '',
                example: 'sk-litellm-replace-me',
                group: 'AI',
                secret: true,
                description: 'LiteLLM proxy API key.',
            },
            {
                key: 'NUXT_LITELLM_CHAT_MODEL',
                value: chatModel,
                group: 'AI',
                description: 'Default chat model id served by the proxy.',
            },
            {
                key: 'NUXT_LITELLM_EMBEDDING_MODEL',
                value: embeddingModel,
                group: 'AI',
                description: 'Default embedding model id (used by RAG).',
            },
        ]
    },

    collectDocs() {
        return [
            {
                heading: 'AI (Mastra)',
                body: [
                    'Mastra is the default AI runtime. The OpenAI SDK is **not** a direct dependency; Mastra talks to LiteLLM via `@ai-sdk/openai`.',
                    '',
                    '- Runtime: `server/mastra/index.ts`',
                    '- Default agent: `server/mastra/agents/default.ts`',
                    '- Add agents/tools/workflows to the Mastra constructor in `index.ts`',
                    '- Swap models by editing the agent (no code path change)',
                    '',
                    'Admins also swap models at runtime from `/dashboard/settings/ai`. The `ai_model_configs` table holds `chat` + `embedding` rows; agents resolve a `key` and use the row\'s `model` value. The page calls `/api/ai/models` (LiteLLM passthrough) for the picker and `PUT /api/ai/configs/:id` to commit changes (admin-only, audit-logged).',
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
            // `mastra dev` does not load `.env`, so NUXT_LITELLM_* is passed through explicitly.
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

// Registers the runtimeConfig keys NUXT_LITELLM_* binds onto.
async function patchBundling(projectDir: string): Promise<void> {
    await patchNuxtConfig(projectDir, (c) => {
        c.mergeRuntimeConfig({
            litellmUrl: '',
            litellmKey: '',
        })
    })
}

// Runtime flag gating the dashboard layout's "AI settings" nav entry.
async function flagMastraAdminEnabled(projectDir: string): Promise<void> {
    await patchNuxtConfig(projectDir, (c) => c.mergeRuntimePublic({ mastraAdmin: true }))
}
