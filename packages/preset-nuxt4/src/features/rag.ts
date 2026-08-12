import prompts from 'prompts'
import { emitTemplate, emitTemplateUpdateMany } from '../utils/emit-template.js'
import { patchNuxtConfig } from '../utils/nuxt-config.js'
import { STAGE } from '@battlestack/core'
import type { EnvVar, Feature, RunContext } from '@battlestack/core'
import { DEFAULT_EMBEDDING_MODEL } from '@battlestack/core/constants/ai.js'

const DEFAULT_DIMENSIONS = 1536
const DEFAULT_CHUNK_SIZE = 512
const DEFAULT_CHUNK_OVERLAP = 50
const DEFAULT_TOP_K = 5

// Native output dimensions per embedding model. Prefix-stripped lookup.
const MODEL_DIMENSIONS: Record<string, number> = {
    'text-embedding-3-small': 1536,
    'text-embedding-3-large': 3072,
    'text-embedding-ada-002': 1536,
    'voyage-3': 1024,
    'voyage-3-lite': 512,
    'voyage-3-large': 1024,
    'voyage-code-3': 1024,
    'embed-english-v3.0': 1024,
    'embed-multilingual-v3.0': 1024,
}

function defaultDimensionsFor(model: string | undefined): number {
    if (!model) return DEFAULT_DIMENSIONS
    const stripped = model.replace(/^[^/]+\//, '')
    return MODEL_DIMENSIONS[stripped] ?? DEFAULT_DIMENSIONS
}

/** RAG on Mastra: chunk → embedMany → PgVector.upsert/query. pgvector ships with `nuxt4:database`. */
export const ragFeature: Feature = {
    id: 'nuxt4:rag',
    version: '1.4.0',
    label: 'RAG (Mastra + pgvector)',
    description: 'Ingest, chunk, embed, and query documents with Mastra + pgvector.',
    frameworks: ['nuxt4'],
    stage: STAGE.RAG,
    requires: ['nuxt4:mastra', 'nuxt4:database'],
    failureIsNonFatal: true,

    collectDeps() {
        return {
            prod: ['@mastra/rag', '@mastra/pg'],
        }
    },

    async prompt(ctx) {
        if (ctx.state.nonInteractive === true) return

        const embeddingModel = await promptEmbeddingModel(
            ctx.state.aiGatewayEmbeddingModels ?? [],
        )
        if (embeddingModel) ctx.state.ragEmbeddingModel = embeddingModel

        const answers = await prompts([
            {
                type: 'number',
                name: 'dimensions',
                message: 'Embedding dimensions',
                initial: defaultDimensionsFor(embeddingModel),
                min: 128,
                max: 4096,
            },
            {
                type: 'select',
                name: 'strategy',
                message: 'Chunking strategy',
                choices: [
                    { title: 'Recursive-character (recommended)', value: 'recursive-character' },
                    { title: 'Fixed-size (legacy)', value: 'fixed-size' },
                ],
                initial: 0,
            },
            {
                type: 'number',
                name: 'chunkSize',
                message: 'Chunk size (tokens)',
                initial: DEFAULT_CHUNK_SIZE,
                min: 64,
                max: 8192,
            },
            {
                type: 'number',
                name: 'chunkOverlap',
                message: 'Chunk overlap (tokens)',
                initial: DEFAULT_CHUNK_OVERLAP,
                min: 0,
                max: 512,
            },
            {
                type: 'number',
                name: 'topK',
                message: 'Top-K retrieved chunks',
                initial: DEFAULT_TOP_K,
                min: 1,
                max: 50,
            },
        ])
        if (answers.dimensions !== undefined) ctx.state.ragDimensions = answers.dimensions
        if (answers.strategy !== undefined) ctx.state.ragChunkingStrategy = answers.strategy
        if (answers.chunkSize !== undefined) ctx.state.ragChunkSize = answers.chunkSize
        if (answers.chunkOverlap !== undefined) ctx.state.ragChunkOverlap = answers.chunkOverlap
        if (answers.topK !== undefined) ctx.state.ragTopK = answers.topK
    },

    collectEnv(ctx): EnvVar[] {
        const dimensions
            = ctx.state.ragDimensions ?? DEFAULT_DIMENSIONS
        const chunkSize = ctx.state.ragChunkSize ?? DEFAULT_CHUNK_SIZE
        const chunkOverlap
            = ctx.state.ragChunkOverlap ?? DEFAULT_CHUNK_OVERLAP
        const topK = ctx.state.ragTopK ?? DEFAULT_TOP_K
        return [
            {
                key: 'NUXT_RAG_EMBEDDING_DIMENSIONS',
                value: String(dimensions),
                group: 'RAG',
                description: 'Vector size. Must match the embedding model output.',
            },
            { key: 'NUXT_RAG_MAX_CHUNK_SIZE', value: String(chunkSize), group: 'RAG' },
            { key: 'NUXT_RAG_CHUNK_OVERLAP', value: String(chunkOverlap), group: 'RAG' },
            { key: 'NUXT_RAG_TOP_K', value: String(topK), group: 'RAG' },
        ]
    },

    collectDocs() {
        return [
            {
                heading: 'RAG',
                body: [
                    'Retrieval-augmented generation. pgvector + Mastra.',
                    '',
                    'Pipeline (`server/utils/rag.ts`): `MDocument.fromText` → recursive chunking → `embedMany` (through the AI gateway via `@ai-sdk/openai-compatible`) → `PgVector.upsert`.',
                    '',
                    '- `POST /api/rag/ingest` body: `{ title, source, text, metadata? }`',
                    '- `POST /api/rag/query` body: `{ query }` returns top-K chunks with scores',
                    '- UI: `/dashboard/rag` (ingest form + query box; nav entry under Admin, gated by the public `rag` flag). Both endpoints require a session.',
                    '- Agent: `server/mastra/agents/rag.ts`: same gateway chat model as `default`, distinct system prompt',
                    '',
                    'Embedding model is admin-controllable: ingestion + query resolve it from the `embedding` row of `ai_model_configs` (registered on boot, edited at `/dashboard/settings/ai`) via `getActiveEmbeddingModelId()`, falling back to `runtimeConfig.rag.embeddingModel` (`NUXT_RAG_*`) / env. So a staging/prod deploy has a working, changeable embedding model with no redeploy. Caveat: switching to a model with a different vector dimension needs a reindex, because `NUXT_RAG_EMBEDDING_DIMENSIONS` is fixed at index creation.',
                    '',
                    'First-time setup: `battlestack db:up && battlestack db:push`. `db:push` applies `server/database/extensions/01_pgvector.sql` (CREATE EXTENSION) before drizzle pushes the schema.',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute(ctx) {
        await emitTemplate(ctx, 'nuxt4:rag', import.meta.url, 'rag')
        await registerRuntimeConfig(ctx)
    },

    async update(ctx, prev) {
        const report = await emitTemplateUpdateMany(ctx, 'nuxt4:rag', import.meta.url, ['rag'], prev)
        await registerRuntimeConfig(ctx)
        return report
    },
}

/** Autocompletes from proxy-fetched models when available, else free text. */
async function promptEmbeddingModel(embeddingModels: string[]): Promise<string | undefined> {
    const useAutocomplete = embeddingModels.length > 0
    const { embeddingModel } = await prompts({
        type: useAutocomplete ? 'autocomplete' : 'text',
        name: 'embeddingModel',
        message: useAutocomplete
            ? 'Embedding model'
            : 'Embedding model name (no proxy fetch, type freely)',
        initial: useAutocomplete ? undefined : DEFAULT_EMBEDDING_MODEL,
        choices: useAutocomplete
            ? embeddingModels.map((m) => ({ title: m, value: m }))
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
    return embeddingModel as string | undefined
}

// Declares the keys `NUXT_RAG_*` binds onto.
async function registerRuntimeConfig(ctx: RunContext): Promise<void> {
    const dimensions = Number(ctx.state.ragDimensions ?? DEFAULT_DIMENSIONS)
    const chunkSize = Number(ctx.state.ragChunkSize ?? DEFAULT_CHUNK_SIZE)
    const chunkOverlap = Number(ctx.state.ragChunkOverlap ?? DEFAULT_CHUNK_OVERLAP)
    const topK = Number(ctx.state.ragTopK ?? DEFAULT_TOP_K)
    await patchNuxtConfig(ctx.projectDir, (c) => {
        c.mergeRuntimeConfig({
            rag: {
                embeddingDimensions: dimensions,
                maxChunkSize: chunkSize,
                chunkOverlap,
                topK,
                embeddingModel: '',
            },
        })
        // Public flag gating the dashboard layout's "Knowledge base" nav entry.
        c.mergeRuntimePublic({ rag: true })
    })
}
