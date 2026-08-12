import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Asserts on template *payload*, not feature behaviour: this repo's CI never runs
 * `vue-tsc` over `templates/`, so a regression stays invisible until someone scaffolds.
 */
const GATEWAY = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'templates',
    'mastra',
    'server',
    'mastra',
    'gateways',
    'openai-compat.ts',
)

const source = (): Promise<string> => readFile(GATEWAY, 'utf8')

/**
 * Source with comments stripped: the file *documents* the version union it avoids, so a
 * naive grep matches the explanation. Assertions must not be satisfiable by prose.
 */
async function code(): Promise<string> {
    return (await source())
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('AI gateway template: AI SDK generation compatibility', () => {
    it('types resolveLanguageModel against Mastra\'s own union', async () => {
        const src = await source()
        expect(src).toContain('type GatewayLanguageModel')
        expect(src).toMatch(/resolveLanguageModel\([\s\S]*?\): Promise<GatewayLanguageModel>/)
    })

    it('never pins the return type to one concrete LanguageModelV<n>', async () => {
        const src = await code()
        // `GatewayLanguageModel` is a union across AI SDK generations, so naming one
        // member is narrower than this class implements and breaks on the next one.
        expect(src).not.toMatch(/LanguageModelV\d/)
    })

    it('does not import types from @ai-sdk/provider', async () => {
        const src = await code()
        // The provider package's generation-specific type exports are that trap; Mastra
        // re-exports what this file needs and tracks whatever it actually accepts.
        expect(src).not.toMatch(/from '@ai-sdk\/provider'/)
    })
})

describe('AI gateway template: generic OpenAI-compatible configuration', () => {
    it('registers under the generic `gateway` id', async () => {
        const src = await code()
        expect(src).toMatch(/readonly id = 'gateway'/)
        // Control: the pre-rename id must be gone from code (not just renamed in prose).
        expect(src).not.toMatch(/readonly id = 'litellm'/)
    })

    it('reads NUXT_AI_GATEWAY_URL/KEY with no legacy env names left', async () => {
        const src = await code()
        expect(src).toContain('NUXT_AI_GATEWAY_URL')
        expect(src).toContain('NUXT_AI_GATEWAY_KEY')
        // The legacy names were dropped outright (nothing scaffolded pre-rename is deployed).
        expect(src).not.toContain('NUXT_LITELLM_')
    })

    it('parses optional NUXT_AI_GATEWAY_HEADERS as JSON and sends them on gateway calls', async () => {
        const src = await code()
        expect(src).toContain('NUXT_AI_GATEWAY_HEADERS')
        expect(src).toMatch(/JSON\.parse/)
        // Both the chat factory and the embedding factory must carry the headers,
        // with per-call headers taking precedence over env headers.
        expect(src).toMatch(/headers: \{ \.\.\.gatewayHeaders\(\), \.\.\.args\.headers \}/)
        expect(src).toMatch(/headers: gatewayHeaders\(\),/)
    })

    it('skips non-scalar header values instead of sending "[object Object]"', async () => {
        const src = await code()
        expect(src).toMatch(/typeof v === 'string' \|\| typeof v === 'number' \|\| typeof v === 'boolean'/)
    })

    it('exposes the shared config guard with machine-readable codes', async () => {
        const src = await code()
        expect(src).toContain('gatewayConfigError')
        expect(src).toContain("'gateway-url-missing'")
        expect(src).toContain("'gateway-key-missing'")
    })

    it('accepts header-based auth in place of an API key', async () => {
        const src = await code()
        expect(src).toContain('hasHeaderAuth')
        // getApiKey must not unconditionally throw on an empty key.
        expect(src).toMatch(/if \(!apiKey && !hasHeaderAuth\(\)\)/)
    })

    it('remembers bare upstream ids so inferred providers are not re-joined', async () => {
        const src = await code()
        expect(src).toContain('bareUpstreamIds')
        expect(src).toMatch(/bareUpstreamIds\.has\(`\$\{providerId\}\/\$\{modelId\}`\)\) return modelId/)
    })

    it('has no sluis-specific code path (sluis is only a scaffold-time preset)', async () => {
        const src = await code()
        // The gateway stays generic: sluis.ai works via URL + headers alone. A
        // NUXT_SLUIS_* env read appearing here would mean provider-specific branching.
        expect(src).not.toMatch(/NUXT_SLUIS_/)
    })
})
