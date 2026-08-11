import { MastraModelGateway, type GatewayLanguageModel, type ProviderConfig } from '@mastra/core/llm'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

/**
 * The only file calling the OpenAI-compatible SDK directly; everything else routes through Mastra agents or this gateway.
 * The upstream is ANY OpenAI-compatible AI gateway — sluis.ai, a self-hosted LiteLLM proxy, or another compatible endpoint — configured by `NUXT_AI_GATEWAY_URL`.
 * Mastra throws on router ids shorter than `<gateway>/<provider>/<model>`, so providers are discovered as buckets from the gateway's `/v1/models`.
 */
export class OpenAICompatGateway extends MastraModelGateway {
    readonly id = 'gateway'
    readonly name = 'AI Gateway (OpenAI-compatible)'

    async fetchProviders(): Promise<Record<string, ProviderConfig>> {
        const modelsByProvider = new Map<string, Set<string>>()
        const { root, apiKey } = gatewayEndpoints()

        if (process.env.DEBUG_AI_GATEWAY) {
            process.stderr.write(
                `[ai-gateway] fetchProviders() invoked, root=${root || '<unset>'} key=${apiKey ? '<set>' : '<unset>'}\n`,
            )
        }

        try {
            const res = await fetch(`${root}/v1/models`, {
                headers: {
                    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
                    ...gatewayHeaders(),
                },
            })
            if (res.ok) {
                const raw = (await res.json()) as
                    | { data?: Array<{ id?: string }> }
                    | Array<{ id?: string }>
                const entries = Array.isArray(raw) ? raw : (raw.data ?? [])

                if (process.env.DEBUG_AI_GATEWAY) {
                    process.stderr.write(
                        `[ai-gateway] /v1/models returned ${entries.length} entries\n`,
                    )
                }

                for (const entry of entries) {
                    const id = entry.id
                    if (!id) continue
                    if (id.includes('*')) continue
                    if (isNonChatModelName(id)) continue

                    let provider: string | null = null
                    let modelName = id
                    if (id.includes('/')) {
                        provider = id.slice(0, id.indexOf('/'))
                        modelName = id.slice(id.indexOf('/') + 1)
                    } else {
                        provider = inferProviderFromName(id)
                    }
                    if (!provider) continue

                    const bucket = modelsByProvider.get(provider) ?? new Set<string>()
                    bucket.add(modelName)
                    modelsByProvider.set(provider, bucket)
                }
            } else if (process.env.DEBUG_AI_GATEWAY) {
                process.stderr.write(
                    `[ai-gateway] /v1/models → ${res.status} ${res.statusText}\n`,
                )
            }
        } catch (err) {
            if (process.env.DEBUG_AI_GATEWAY) {
                const msg = err instanceof Error ? err.message : String(err)
                process.stderr.write(`[ai-gateway] /v1/models fetch failed: ${msg}\n`)
            }
        }

        const out: Record<string, ProviderConfig> = {}
        for (const [id, models] of modelsByProvider) {
            if (models.size === 0) continue
            out[id] = this.providerConfig(`${id} via AI gateway`, [...models].sort())
        }
        return out
    }

    buildUrl(_modelId: string, _envVars: Record<string, string>): string {
        return gatewayEndpoints().apiRoot
    }

    async getApiKey(): Promise<string> {
        const { apiKey } = gatewayEndpoints()
        if (!apiKey) throw new Error('runtimeConfig.aiGatewayKey is not set')
        return apiKey
    }

    /**
     * Return type is Mastra's `GatewayLanguageModel` union (`LanguageModelV2 | V3 | V4`), not a concrete `LanguageModelVn` from `@ai-sdk/provider`, on purpose.
     * Naming one version would go red the moment `@ai-sdk/openai-compatible` bumps generations while Mastra still supports it (this happened when openai-compatible 3.x moved to V4).
     */
    async resolveLanguageModel(args: {
        modelId: string
        providerId: string
        apiKey: string
        headers?: Record<string, string>
    }): Promise<GatewayLanguageModel> {
        const upstreamId = toUpstreamId(args.providerId, args.modelId)
        return createOpenAICompatible({
            name: 'gateway',
            apiKey: args.apiKey,
            baseURL: gatewayEndpoints().apiRoot,
            headers: { ...gatewayHeaders(), ...args.headers },
        }).chatModel(upstreamId)
    }

    private providerConfig(label: string, models: string[]): ProviderConfig {
        return {
            name: label,
            models,
            apiKeyEnvVar: 'NUXT_AI_GATEWAY_KEY',
            gateway: this.id,
            url: gatewayEndpoints().apiRoot,
        }
    }
}

/**
 * Build an embedding model routed through the AI gateway. Direct openai-compatible use is intentional: Mastra core doesn't gateway embedding models.
 */
export function gatewayEmbedding(modelId: string) {
    const { apiRoot, apiKey } = gatewayEndpoints()
    return createOpenAICompatible({
        name: 'gateway',
        apiKey,
        baseURL: apiRoot,
        headers: gatewayHeaders(),
    }).textEmbeddingModel(modelId)
}

/**
 * Normalizes the gateway URL (strips/re-appends trailing `/v1`) and throws if unset, so an unconfigured project fails loudly instead of silently hitting a bad upstream.
 * Reads `process.env` directly (not `useRuntimeConfig`) because this gateway also loads under standalone `mastra dev` Studio, which has no Nitro runtime context.
 * `NUXT_LITELLM_URL`/`NUXT_LITELLM_KEY` are read as a legacy fallback so a project scaffolded before the generic-gateway rename keeps working after `battlestack pull`.
 */
export function gatewayEndpoints(): { root: string; apiRoot: string; apiKey: string } {
    const raw = String(
        process.env.NUXT_AI_GATEWAY_URL ?? process.env.NUXT_LITELLM_URL ?? '',
    ).trim()
    if (!raw) {
        throw new Error(
            'NUXT_AI_GATEWAY_URL is not set. Point it at your OpenAI-compatible AI gateway (e.g. https://api.sluis.ai) in `.env`.',
        )
    }
    const root = raw.replace(/\/+$/, '').replace(/\/v1$/i, '')
    return {
        root,
        apiRoot: `${root}/v1`,
        apiKey: String(
            process.env.NUXT_AI_GATEWAY_KEY ?? process.env.NUXT_LITELLM_KEY ?? '',
        ),
    }
}

let warnedBadHeaders = false

/**
 * Optional extra request headers from `NUXT_AI_GATEWAY_HEADERS` (a JSON object), sent on every gateway call.
 * This is how gateway-specific knobs are passed without dedicated code paths — e.g. sluis.ai's per-request residency override: `{"X-Sluis-Residency":"eu-only"}`.
 */
export function gatewayHeaders(): Record<string, string> {
    const raw = String(process.env.NUXT_AI_GATEWAY_HEADERS ?? '').trim()
    if (!raw) return {}
    try {
        const parsed = JSON.parse(raw) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const out: Record<string, string> = {}
            for (const [k, v] of Object.entries(parsed)) out[k] = String(v)
            return out
        }
    } catch {
        // Fall through to the warning below.
    }
    if (!warnedBadHeaders) {
        warnedBadHeaders = true
        process.stderr.write(
            '[ai-gateway] NUXT_AI_GATEWAY_HEADERS is not a JSON object; ignoring it\n',
        )
    }
    return {}
}

/**
 * `/v1/models` doesn't expose a `mode` field, so non-chat models (embedding, tts, image, moderation, etc.) are filtered by name pattern instead.
 */
function isNonChatModelName(id: string): boolean {
    const lower = id.toLowerCase()
    return (
        lower.includes('embed') ||
        lower.includes('whisper') ||
        lower.includes('tts') ||
        lower.includes('dall-e') ||
        lower.includes('moderation') ||
        lower.includes('transcribe') ||
        lower.includes('gpt-image') ||
        lower.includes('sora') ||
        /\/(low|medium|high|standard|hd)\//.test(lower) ||
        /\/\d+-x-\d+\//.test(lower) ||
        lower.startsWith('voyage') ||
        lower.includes('/voyage')
    )
}

function toUpstreamId(providerId: string, modelId: string): string {
    if (providerId === 'custom') return modelId
    if (modelId.startsWith(`${providerId}/`)) return modelId
    return `${providerId}/${modelId}`
}

function inferProviderFromName(modelGroup: string): string | null {
    const name = modelGroup.toLowerCase()
    if (
        name.startsWith('gpt-') ||
        name.startsWith('o1') ||
        name.startsWith('o3') ||
        name === 'chatgpt-4o-latest' ||
        name.startsWith('babbage') ||
        name.startsWith('davinci')
    ) {
        return 'openai'
    }
    if (name.startsWith('claude')) return 'anthropic'
    if (name.startsWith('gemini')) return 'gemini'
    if (name.startsWith('command') || name.startsWith('c4ai')) return 'cohere'
    if (
        name.startsWith('mistral') ||
        name.startsWith('mixtral') ||
        name.startsWith('codestral') ||
        name.startsWith('open-mistral') ||
        name.startsWith('open-mixtral')
    ) {
        return 'mistral'
    }
    if (name.startsWith('grok')) return 'xai'
    if (name.startsWith('deepseek')) return 'deepseek'
    if (name.startsWith('llama')) return 'meta'
    if (name.startsWith('voyage')) return 'voyage'
    return null
}
