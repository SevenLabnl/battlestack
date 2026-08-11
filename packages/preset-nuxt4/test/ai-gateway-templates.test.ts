import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Source-text assertions over every template consumer of the AI gateway. CI never
 * type-checks `templates/`, so a consumer left pointing at the pre-rename
 * `gateways/litellm` module would only surface when someone scaffolds a project.
 */
const TEMPLATES = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'templates',
)

const read = (...parts: string[]): Promise<string> =>
    readFile(path.join(TEMPLATES, ...parts), 'utf8')

describe('model resolution routes through the generic gateway', () => {
    it('ai-model.ts builds `gateway/`-prefixed router ids and strips the legacy prefix', async () => {
        const src = await read('mastra', 'server', 'mastra', 'utils', 'ai-model.ts')
        expect(src).toMatch(/`gateway\/\$\{/)
        // Legacy DB rows written before the rename carry `litellm/`; they must be
        // re-prefixed, not returned as-is (the `litellm` gateway no longer exists).
        expect(src).toContain("stored.startsWith('litellm/')")
        expect(src).not.toContain("if (stored.startsWith('litellm/')) return stored")
        // Control: no `litellm/`-prefixed id is ever *produced* anymore.
        expect(src).not.toMatch(/`litellm\/\$\{/)
    })

    it('env fallbacks prefer NUXT_AI_GATEWAY_* over the legacy names', async () => {
        for (const file of [
            ['mastra', 'server', 'mastra', 'utils', 'ai-model.ts'],
            ['mastra', 'server', 'mastra', 'utils', 'model-configs.ts'],
        ]) {
            const src = await read(...file)
            const gatewayFirst = src.indexOf('NUXT_AI_GATEWAY_CHAT_MODEL')
            const legacy = src.indexOf('NUXT_LITELLM_CHAT_MODEL')
            expect(gatewayFirst).toBeGreaterThan(-1)
            expect(legacy).toBeGreaterThan(gatewayFirst)
        }
    })

    it('the Mastra instance registers the OpenAICompatGateway under `gateway`', async () => {
        const src = await read('mastra', 'server', 'mastra', 'index.ts')
        expect(src).toContain('gateways: { gateway: new OpenAICompatGateway() }')
        expect(src).not.toContain('LiteLLMGateway')
    })

    it('the admin model picker and RAG embeddings import from gateways/openai-compat', async () => {
        const models = await read('mastra', 'server', 'api', 'ai', 'models.get.ts')
        expect(models).toContain("from '#server/mastra/gateways/openai-compat'")
        const rag = await read('rag', 'server', 'utils', 'rag.ts')
        expect(rag).toContain("from '#server/mastra/gateways/openai-compat'")
        expect(rag).toContain('gatewayEmbedding')
        // Control: the pre-rename exports must be gone.
        expect(models).not.toContain('litellmEndpoints')
        expect(rag).not.toContain('litellmEmbedding')
    })
})

describe('chat endpoints fail fast on the renamed config keys', () => {
    it.each([
        ['http', ['chat', 'http', 'server', 'api', 'chat.post.ts']],
        ['ws-nitro', ['chat', 'ws-nitro', 'server', 'routes', '_ws.ts']],
    ])('%s transport checks aiGateway config with the legacy binding as fallback', async (_label, file) => {
        const src = await read(...file)
        expect(src).toContain('config.aiGatewayUrl')
        expect(src).toContain('config.aiGatewayKey')
        expect(src).toContain('NUXT_AI_GATEWAY_URL is not set')
        expect(src).toContain('NUXT_AI_GATEWAY_KEY is not set')
        // Upgraded projects still bind the old env names onto these keys.
        expect(src).toContain('config.litellmUrl')
        expect(src).toContain('config.litellmKey')
    })

    it.each([
        ['http', ['chat', 'http', 'app', 'components', 'Chat.vue']],
        ['ws-nitro', ['chat', 'ws-nitro', 'app', 'composables', 'useChatAgent.ts']],
    ])('%s frontend classifies both current and legacy error strings', async (_label, file) => {
        const src = await read(...file)
        expect(src).toContain('NUXT_(?:AI_GATEWAY|LITELLM)_KEY')
        expect(src).toContain('NUXT_(?:AI_GATEWAY|LITELLM)_URL')
    })
})
