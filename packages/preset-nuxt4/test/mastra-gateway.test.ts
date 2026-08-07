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
    'litellm.ts',
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

describe('LiteLLM gateway template: AI SDK generation compatibility', () => {
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
