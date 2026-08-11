import { EMBEDDING_PATTERNS } from '../constants/ai.js'
import type { GatewayModels, GatewayFetchError, GatewayFetchResult } from '../types/ai-gateway.js'

export function isEmbeddingModel(modelId: string): boolean {
    const lower = modelId.toLowerCase()
    return EMBEDDING_PATTERNS.some((p) => lower.includes(p))
}

/** Dedupe model ids and drop wildcards / bare names when a `<provider>/<name>` form exists. */
export function unifyModelIds(ids: string[]): string[] {
    const seen = new Set<string>()
    const cleaned: string[] = []
    for (const id of ids) {
        if (!id || seen.has(id)) continue
        if (id.includes('*')) continue
        seen.add(id)
        cleaned.push(id)
    }
    const prefixedTails = new Set<string>()
    for (const id of cleaned) {
        const slash = id.indexOf('/')
        if (slash > 0) prefixedTails.add(id.slice(slash + 1))
    }
    return cleaned.filter((id) => id.includes('/') || !prefixedTails.has(id))
}

export async function fetchGatewayModels(
    apiKey: string,
    baseUrl: string,
    timeoutMs = 10_000,
): Promise<GatewayModels | null> {
    const { models } = await fetchGatewayModelsDetailed(apiKey, baseUrl, timeoutMs)
    return models
}

/**
 * `fetchGatewayModels` with a discriminated error: auth, network or empty gateway.
 * Works against any OpenAI-compatible gateway (`GET /v1/models` + bearer auth):
 * a LiteLLM proxy, sluis.ai, or anything else speaking the same surface.
 */
export async function fetchGatewayModelsDetailed(
    apiKey: string,
    baseUrl: string,
    timeoutMs = 10_000,
): Promise<GatewayFetchResult> {
    const url = baseUrl.replace(/\/+$/, '').replace(/\/v1$/i, '') + '/v1/models'
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    try {
        let res: Response
        try {
            res = await fetch(url, {
                headers: { Authorization: `Bearer ${apiKey}` },
                signal: ac.signal,
            })
        } catch (err) {
            const e = err as Error & { name?: string }
            if (e.name === 'AbortError') return { models: null, error: { kind: 'timeout' } }
            return { models: null, error: { kind: 'network', message: e.message } }
        }
        if (!res.ok) {
            return {
                models: null,
                error: { kind: 'http', status: res.status, statusText: res.statusText },
            }
        }
        let raw: { data?: Array<{ id?: string }> } | Array<{ id?: string }>
        try {
            raw = (await res.json()) as typeof raw
        } catch (err) {
            return { models: null, error: { kind: 'parse', message: (err as Error).message } }
        }
        const entries = Array.isArray(raw) ? raw : (raw.data ?? [])
        const ids = entries.map((m) => m.id ?? '').filter(Boolean)
        if (ids.length === 0) return { models: null, error: { kind: 'empty' } }
        const unified = unifyModelIds(ids)
        const chat: string[] = []
        const embedding: string[] = []
        for (const id of unified) {
            if (isEmbeddingModel(id)) embedding.push(id)
            else chat.push(id)
        }
        chat.sort((a, b) => a.localeCompare(b))
        embedding.sort((a, b) => a.localeCompare(b))
        return { models: { chat, embedding }, error: null }
    } finally {
        clearTimeout(timer)
    }
}

/** `label` names the gateway in user-facing copy: `LiteLLM`, `sluis.ai`, or the generic default. */
export function describeGatewayError(err: GatewayFetchError, label = 'AI gateway'): string {
    switch (err.kind) {
        case 'timeout': return `${label} request timed out; check the URL is reachable from your network`
        case 'network': return `${label} network error: ${err.message}`
        case 'http': {
            const auth = err.status === 401 || err.status === 403
            return auth
                ? `${label} rejected the key (${err.status} ${err.statusText}); check NUXT_AI_GATEWAY_KEY`
                : `${label} returned ${err.status} ${err.statusText}`
        }
        case 'parse': return `${label} response was not valid JSON: ${err.message}`
        case 'empty': return `${label} returned no models`
    }
}
