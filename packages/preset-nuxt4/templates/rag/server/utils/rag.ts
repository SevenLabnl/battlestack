import { MDocument } from '@mastra/rag'
import { PgVector } from '@mastra/pg'
import { embedMany } from 'ai'
import { gatewayEmbedding } from '#server/mastra/gateways/openai-compat'
import { getActiveEmbeddingModelId } from '#server/mastra/utils/ai-model'

export const INDEX_NAME = 'rag_vectors'

let _store: PgVector | null = null
let _embeddingModel: ReturnType<typeof gatewayEmbedding> | null = null
let _embeddingModelId: string | null = null
let _initPromise: Promise<void> | null = null

interface RagConfig {
    maxChunkSize: number
    chunkOverlap: number
    topK: number
    embeddingDimensions: number
    embeddingModel: string
    databaseUrl: string
}

function readConfig(): RagConfig {
    const config = useRuntimeConfig() as unknown as {
        databaseUrl?: unknown
        rag?: {
            // Key names mirror the NUXT_RAG_* env vars (NUXT_RAG_MAX_CHUNK_SIZE → rag.maxChunkSize); Nuxt binds env onto these exact paths.
            maxChunkSize?: unknown
            chunkOverlap?: unknown
            topK?: unknown
            embeddingDimensions?: unknown
            embeddingModel?: unknown
        }
    }
    const rag = config.rag ?? {}
    return {
        maxChunkSize: Number(rag.maxChunkSize ?? 512),
        chunkOverlap: Number(rag.chunkOverlap ?? 50),
        topK: Number(rag.topK ?? 5),
        embeddingDimensions: Number(rag.embeddingDimensions ?? 1536),
        embeddingModel: String(rag.embeddingModel ?? 'openai/text-embedding-3-small'),
        databaseUrl: String(config.databaseUrl ?? ''),
    }
}

function getStore(cfg: RagConfig): PgVector {
    if (!_store) {
        _store = new PgVector({ id: 'rag', connectionString: cfg.databaseUrl })
    }
    return _store
}

// Admin-controllable via `ai_model_configs.embedding`, memoised by id so a change takes effect without rebuilding the model object.
// HAZARD: switching to a model with a different vector dimension requires reindexing; the pgvector column width is fixed at index creation.
async function getModel(cfg: RagConfig): Promise<ReturnType<typeof gatewayEmbedding>> {
    const id = await getActiveEmbeddingModelId(cfg.embeddingModel || undefined)
    if (!_embeddingModel || _embeddingModelId !== id) {
        _embeddingModel = gatewayEmbedding(id)
        _embeddingModelId = id
    }
    return _embeddingModel
}

function ensureIndex(cfg: RagConfig): Promise<void> {
    if (_initPromise) return _initPromise
    _initPromise = getStore(cfg)
        .createIndex({ indexName: INDEX_NAME, dimension: cfg.embeddingDimensions })
        .catch(() => {
            // Index already exists, ignore
        })
    return _initPromise
}

export async function ingestText(opts: {
    title: string
    source: string
    text: string
    metadata?: Record<string, unknown>
}): Promise<{ chunks: number }> {
    const cfg = readConfig()
    await ensureIndex(cfg)
    const doc = MDocument.fromText(opts.text, {
        title: opts.title,
        source: opts.source,
        ...opts.metadata,
    })

    const chunks = await doc.chunk({
        strategy: 'recursive',
        maxSize: cfg.maxChunkSize,
        overlap: cfg.chunkOverlap,
    })

    const { embeddings } = await embedMany({
        model: await getModel(cfg),
        values: chunks.map((c) => c.text),
    })

    await getStore(cfg).upsert({
        indexName: INDEX_NAME,
        vectors: embeddings,
        metadata: chunks.map((c) => ({
            text: c.text,
            title: opts.title,
            source: opts.source,
            ...opts.metadata,
            ...c.metadata,
        })),
    })

    return { chunks: chunks.length }
}

export async function queryText(query: string): Promise<{
    results: Array<{ score: number, metadata: Record<string, unknown> }>
}> {
    const cfg = readConfig()
    await ensureIndex(cfg)
    const { embeddings } = await embedMany({
        model: await getModel(cfg),
        values: [query],
    })

    const raw = await getStore(cfg).query({
        indexName: INDEX_NAME,
        queryVector: embeddings[0]!,
        topK: cfg.topK,
    })

    const results = raw.map((r) => ({
        score: r.score,
        metadata: r.metadata ?? {},
    }))

    return { results }
}
