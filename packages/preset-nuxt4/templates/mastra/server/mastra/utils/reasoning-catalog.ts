// Relative imports so `mastra dev` (standalone bundler) can resolve these too.
import { fetchGatewayModels, type GatewayModel } from '../gateways/openai-compat'
import { resolveReasoningSupport, type ReasoningEffort, type ReasoningSupport } from './reasoning'

function normalize(modelId: string): string {
    const id = modelId.trim().toLowerCase()
    return id.startsWith('gateway/') ? id.slice('gateway/'.length) : id
}

/** The gateway entry for a stored id: an exact match, else the only entry with the same bare name. */
function findEntry(models: GatewayModel[], modelId: string): GatewayModel | undefined {
    const id = normalize(modelId)
    const exact = models.find((m) => m.id.toLowerCase() === id)
    if (exact) return exact
    const bare = id.split('/').pop()
    const sameName = models.filter((m) => m.id.toLowerCase().split('/').pop() === bare)
    return sameName.length === 1 ? sameName[0] : undefined
}

/** Reasoning levels for a model: what the gateway reports, else the fallback table in `reasoning.ts`. */
export async function getReasoningSupport(modelId: string): Promise<ReasoningSupport | null> {
    const entry = findEntry(await fetchGatewayModels(), modelId)
    return resolveReasoningSupport(modelId, entry?.capabilities)
}

/** Adds the selector data the admin page needs to a model config row. Embedding rows get none. */
export async function withReasoningSupport<T extends { key: string, model: string }>(row: T): Promise<T & {
    reasoningEfforts: ReasoningEffort[]
    defaultReasoningEffort: ReasoningEffort | null
}> {
    const support = row.key === 'embedding' ? null : await getReasoningSupport(row.model)
    return { ...row, reasoningEfforts: support?.levels ?? [], defaultReasoningEffort: support?.defaultLevel ?? null }
}
