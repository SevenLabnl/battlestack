import { MastraModelGateway, type GatewayLanguageModel, type ProviderConfig } from '@mastra/core/llm'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

/**
 * The only file calling the OpenAI-compatible SDK directly; everything else routes through Mastra agents or this gateway.
 * The upstream is ANY OpenAI-compatible AI gateway — sluis.ai, a self-hosted LiteLLM proxy, or another compatible endpoint — configured by `NUXT_AI_GATEWAY_URL`.
 * Mastra throws on router ids shorter than `<gateway>/<provider>/<model>`, so providers are discovered as buckets from the gateway's `/v1/models`.
 *
 * Header precedence on every request, lowest to highest: SDK auth (from the API key) → `NUXT_AI_GATEWAY_HEADERS` → per-call headers.
 */
export class OpenAICompatGateway extends MastraModelGateway {
    readonly id = 'gateway'
    readonly name = 'AI Gateway (OpenAI-compatible)'

    async fetchProviders(): Promise<Record<string, ProviderConfig>> {
        const modelsByProvider = new Map<string, Set<string>>()

        for (const id of await fetchGatewayModelIds()) {
            if (isNonChatModelName(id)) continue

            let provider: string | null = null
            let modelName = id
            if (id.includes('/')) {
                provider = id.slice(0, id.indexOf('/'))
                modelName = id.slice(id.indexOf('/') + 1)
            } else {
                provider = inferProviderFromName(id)
                // The gateway serves this model under its bare name; remember that so
                // resolveLanguageModel doesn't re-join the inferred provider onto it.
                if (provider) bareUpstreamIds.add(`${provider}/${id}`)
            }
            if (!provider) continue

            const bucket = modelsByProvider.get(provider) ?? new Set<string>()
            bucket.add(modelName)
            modelsByProvider.set(provider, bucket)
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

    /**
     * The key is optional when `NUXT_AI_GATEWAY_HEADERS` carries its own auth (an `Authorization`
     * header), matching discovery and embeddings, which already work keyless. Only a config with
     * neither fails loudly here.
     */
    async getApiKey(): Promise<string> {
        const { apiKey } = gatewayEndpoints()
        if (!apiKey && !hasHeaderAuth()) {
            throw new Error('NUXT_AI_GATEWAY_KEY is not set')
        }
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

let _endpoints: { root: string; apiRoot: string; apiKey: string } | null = null

/**
 * Normalizes the gateway URL (strips/re-appends trailing `/v1`) and throws if unset, so an unconfigured project fails loudly instead of silently hitting a bad upstream.
 * Reads `process.env` directly (not `useRuntimeConfig`) because this gateway also loads under standalone `mastra dev` Studio, which has no Nitro runtime context.
 * Memoized: env is process-constant and this is on the per-message hot path.
 */
export function gatewayEndpoints(): { root: string; apiRoot: string; apiKey: string } {
    if (_endpoints) return _endpoints
    const raw = String(process.env.NUXT_AI_GATEWAY_URL ?? '').trim()
    if (!raw) {
        throw new Error(
            'NUXT_AI_GATEWAY_URL is not set. Point it at your OpenAI-compatible AI gateway (e.g. https://api.sluis.ai) in `.env`.',
        )
    }
    const root = raw.replace(/\/+$/, '').replace(/\/v1$/i, '')
    _endpoints = {
        root,
        apiRoot: `${root}/v1`,
        apiKey: String(process.env.NUXT_AI_GATEWAY_KEY ?? '').trim(),
    }
    return _endpoints
}

export type GatewayConfigErrorCode = 'gateway-url-missing' | 'gateway-key-missing'

/**
 * The single fail-fast check the chat endpoints share, resolving config exactly like
 * `gatewayEndpoints()` does (process.env), so the guard can never pass while the
 * gateway itself would throw. Returns null when chat calls can proceed.
 */
export function gatewayConfigError(): { code: GatewayConfigErrorCode, message: string } | null {
    if (!String(process.env.NUXT_AI_GATEWAY_URL ?? '').trim()) {
        return { code: 'gateway-url-missing', message: 'NUXT_AI_GATEWAY_URL is not set' }
    }
    if (!String(process.env.NUXT_AI_GATEWAY_KEY ?? '').trim() && !hasHeaderAuth()) {
        return { code: 'gateway-key-missing', message: 'NUXT_AI_GATEWAY_KEY is not set' }
    }
    return null
}

let _headers: Record<string, string> | null = null

/**
 * Optional extra request headers from `NUXT_AI_GATEWAY_HEADERS` (a JSON object of string/number/boolean values), sent on every gateway call.
 * This is how gateway-specific knobs are passed without dedicated code paths — e.g. sluis.ai's per-request residency override: `{"X-Sluis-Residency":"eu-only"}`.
 * Parsed once per process; entries with nested values are skipped with a warning instead of being sent as "[object Object]".
 */
export function gatewayHeaders(): Record<string, string> {
    if (_headers) return _headers
    const out: Record<string, string> = {}
    const raw = String(process.env.NUXT_AI_GATEWAY_HEADERS ?? '').trim()
    if (raw) {
        let parsed: unknown = null
        try {
            parsed = JSON.parse(raw)
        } catch {
            parsed = null
        }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            for (const [k, v] of Object.entries(parsed)) {
                if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
                    out[k] = String(v)
                } else {
                    process.stderr.write(
                        `[ai-gateway] NUXT_AI_GATEWAY_HEADERS entry "${k}" is not a string/number/boolean; skipping it\n`,
                    )
                }
            }
        } else {
            process.stderr.write(
                '[ai-gateway] NUXT_AI_GATEWAY_HEADERS is not a JSON object; ignoring it\n',
            )
        }
    }
    _headers = out
    return _headers
}

function hasHeaderAuth(): boolean {
    return Object.keys(gatewayHeaders()).some((k) => k.toLowerCase() === 'authorization')
}

/**
 * Raw model ids from the gateway's `/v1/models` (`{data: [...]}` or a bare array, depending on
 * deployment), wildcards dropped. Shared by provider discovery and the admin model picker.
 * Errors resolve to an empty list — discovery and the picker both degrade gracefully.
 */
export async function fetchGatewayModelIds(): Promise<string[]> {
    let endpoints: { root: string; apiKey: string }
    try {
        endpoints = gatewayEndpoints()
    } catch {
        return []
    }
    try {
        const res = await fetch(`${endpoints.root}/v1/models`, {
            headers: {
                ...(endpoints.apiKey ? { Authorization: `Bearer ${endpoints.apiKey}` } : {}),
                ...gatewayHeaders(),
            },
        })
        if (!res.ok) {
            if (process.env.DEBUG_AI_GATEWAY) {
                process.stderr.write(`[ai-gateway] /v1/models → ${res.status} ${res.statusText}\n`)
            }
            return []
        }
        const raw = (await res.json()) as { data?: Array<{ id?: string }> } | Array<{ id?: string }>
        const entries = Array.isArray(raw) ? raw : (raw.data ?? [])
        return entries
            .map((m) => m.id)
            .filter((id): id is string => Boolean(id))
            .filter((id) => !id.includes('*'))
    } catch (err) {
        if (process.env.DEBUG_AI_GATEWAY) {
            const msg = err instanceof Error ? err.message : String(err)
            process.stderr.write(`[ai-gateway] /v1/models fetch failed: ${msg}\n`)
        }
        return []
    }
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

// `provider/model` router pairs whose upstream id is the BARE model name: the gateway listed the
// model without a provider prefix and discovery inferred one for Mastra's router. Populated during
// fetchProviders; when a pair isn't here (e.g. Mastra served its registry from cache in a fresh
// process), toUpstreamId falls back to the prefixed join.
const bareUpstreamIds = new Set<string>()

function toUpstreamId(providerId: string, modelId: string): string {
    if (providerId === 'custom') return modelId
    if (modelId.startsWith(`${providerId}/`)) return modelId
    if (bareUpstreamIds.has(`${providerId}/${modelId}`)) return modelId
    return `${providerId}/${modelId}`
}

/**
 * Provider inference for bare model names. Also consumed by `utils/ai-model.ts` when repairing
 * DB-stored ids, so both sides of the router agree on the bucket a bare name lands in.
 */
export function inferProviderFromName(modelGroup: string): string | null {
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
