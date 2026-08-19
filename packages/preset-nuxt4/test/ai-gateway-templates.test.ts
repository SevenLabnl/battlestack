import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FALLBACK_CHAT_MODEL } from '@battlestack/core/constants/ai.js'

/**
 * Source-text assertions over every template consumer of the AI gateway. CI never
 * type-checks `templates/`, so a consumer left pointing at a renamed module or a
 * retired export would only surface when someone scaffolds a project.
 */
const TEMPLATES = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'templates',
)

const read = (...parts: string[]): Promise<string> =>
    readFile(path.join(TEMPLATES, ...parts), 'utf8')

describe('model resolution routes through the generic gateway', () => {
    it('ai-model.ts repairs any stored shape into gateway/<provider>/<model>', async () => {
        const src = await read('mastra', 'server', 'mastra', 'utils', 'ai-model.ts')
        expect(src).toMatch(/`gateway\/\$\{/)
        // A stored `gateway/` prefix is stripped and re-normalized, so a malformed
        // two-segment id is repaired rather than passed through to a router throw.
        expect(src).toContain("stored.startsWith('gateway/')")
        expect(src).not.toContain("if (stored.startsWith('gateway/')) return stored")
        // Control: no legacy handling and no second provider-inference table.
        expect(src).not.toContain('litellm')
        expect(src).toContain("import { inferProviderFromName } from '../gateways/openai-compat'")
        expect(src).not.toMatch(/function inferProviderFromName/)
    })

    // The template cannot import `@battlestack/core`, so it keeps its own copy of the
    // fallback id. This is the only thing keeping the two in step.
    it('the scaffolded chat fallback matches FALLBACK_CHAT_MODEL', async () => {
        const shared = await read('mastra', 'server', 'mastra', 'utils', 'env-defaults.ts')
        expect(shared).toContain(`const FALLBACK_CHAT_MODEL = '${FALLBACK_CHAT_MODEL}'`)
    })

    it('reaches for the sluis alias only when the gateway is sluis', async () => {
        const shared = await read('mastra', 'server', 'mastra', 'utils', 'env-defaults.ts')
        // A non-sluis gateway 404s on `sluis/chat`, so the alias must sit behind the host check.
        expect(shared).toMatch(/gatewayIsSluis\(\)\s*\?\s*'sluis\/chat'\s*:\s*FALLBACK_CHAT_MODEL/)
        expect(shared).toContain("const SLUIS_HOST = 'sluis.ai'")
        // Host-matched, not substring-matched: `sluis.ai.evil.test` must not read as sluis.
        expect(shared).toContain('new URL(raw).hostname')
        expect(shared).toContain('host.endsWith(`.${SLUIS_HOST}`)')
    })

    it('env model defaults resolve through the single shared helper', async () => {
        const shared = await read('mastra', 'server', 'mastra', 'utils', 'env-defaults.ts')
        expect(shared).toContain('NUXT_AI_GATEWAY_CHAT_MODEL')
        expect(shared).toContain('NUXT_AI_GATEWAY_EMBEDDING_MODEL')
        expect(shared).not.toContain('NUXT_LITELLM_')
        for (const file of [
            ['mastra', 'server', 'mastra', 'utils', 'ai-model.ts'],
            ['mastra', 'server', 'mastra', 'utils', 'model-configs.ts'],
        ]) {
            const src = await read(...file)
            expect(src).toContain("from './env-defaults'")
            // Control: no consumer keeps its own copy of the fallback chain.
            expect(src).not.toContain('NUXT_AI_GATEWAY_CHAT_MODEL')
        }
    })

    it('the Mastra instance registers the OpenAICompatGateway under `gateway`', async () => {
        const src = await read('mastra', 'server', 'mastra', 'index.ts')
        expect(src).toContain('gateways: { gateway: new OpenAICompatGateway() }')
        expect(src).not.toContain('LiteLLMGateway')
    })

    it('the admin model picker reuses the gateway module\'s models fetch', async () => {
        const src = await read('mastra', 'server', 'api', 'ai', 'models.get.ts')
        expect(src).toContain("import { fetchGatewayModelIds } from '#server/mastra/gateways/openai-compat'")
        // Control: no second hand-rolled models request in this route (prose may
        // still name the endpoint; an actual call would need a fetch invocation).
        expect(src).not.toMatch(/\$fetch|await fetch\(/)
        expect(src).not.toContain('Authorization')
    })

    it('RAG embeddings import from gateways/openai-compat', async () => {
        const src = await read('rag', 'server', 'utils', 'rag.ts')
        expect(src).toContain("from '#server/mastra/gateways/openai-compat'")
        expect(src).toContain('gatewayEmbedding')
        expect(src).not.toContain('litellmEmbedding')
    })
})

describe('chat endpoints fail fast through the shared gateway guard', () => {
    it.each([
        ['http', ['chat', 'http', 'server', 'api', 'chat.post.ts']],
        ['ws-nitro', ['chat', 'ws-nitro', 'server', 'routes', '_ws.ts']],
    ])('%s transport uses gatewayConfigError with a machine-readable code', async (_label, file) => {
        const src = await read(...file)
        expect(src).toContain('gatewayConfigError')
        expect(src).toContain('configError.code')
        // Control: no per-endpoint duplicate of the guard remains.
        expect(src).not.toContain('config.aiGatewayUrl')
        expect(src).not.toContain('config.litellmUrl')
    })

    it('the ws frontend classifies by code first, message sniff as fallback', async () => {
        const src = await read('chat', 'ws-nitro', 'app', 'composables', 'useChatAgent.ts')
        expect(src).toContain("code === 'gateway-key-missing'")
        expect(src).toContain("code === 'gateway-url-missing'")
        expect(src).toMatch(/NUXT_AI_GATEWAY_KEY/)
        expect(src).not.toContain('LITELLM')
    })

    it('the http frontend matches the current env names only', async () => {
        const src = await read('chat', 'http', 'app', 'components', 'Chat.vue')
        expect(src).toMatch(/NUXT_AI_GATEWAY_KEY/)
        expect(src).toMatch(/NUXT_AI_GATEWAY_URL/)
        expect(src).not.toContain('LITELLM')
    })
})

describe('no legacy gateway wiring remains anywhere in templates', () => {
    // Prose may still say "e.g. a self-hosted LiteLLM proxy" — that's a product name,
    // not wiring. These are the identifiers that would mean live legacy code paths.
    const LEGACY = /NUXT_LITELLM_|litellmUrl|litellmKey|litellmEndpoints|litellmEmbedding|LiteLLMGateway|litellm\//

    it.each([
        ['mastra runtime config', ['mastra', 'server', 'mastra', 'index.ts']],
        ['gateway module', ['mastra', 'server', 'mastra', 'gateways', 'openai-compat.ts']],
        ['env defaults', ['mastra', 'server', 'mastra', 'utils', 'env-defaults.ts']],
        ['model configs', ['mastra', 'server', 'mastra', 'utils', 'model-configs.ts']],
        ['chat http server', ['chat', 'http', 'server', 'api', 'chat.post.ts']],
        ['chat ws server', ['chat', 'ws-nitro', 'server', 'routes', '_ws.ts']],
    ])('%s contains no legacy identifiers', async (_label, file) => {
        const src = await read(...file)
        expect(src).not.toMatch(LEGACY)
    })
})
