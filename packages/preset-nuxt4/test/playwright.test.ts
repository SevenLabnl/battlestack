import { describe, expect, it } from 'vitest'
import { playwrightFeature } from '../src/features/playwright.js'
import { mockRunContext } from './test-utils.js'

/**
 * `collectDeps`/`collectEnv` were only exercised indirectly, via `ai-tool-config`'s
 * MCP-entry assertions. This covers the two contributions directly.
 */
describe('playwrightFeature', () => {
    it('declares playwright + vitest test-utils as dev deps', () => {
        const deps = playwrightFeature.collectDeps!(mockRunContext())
        expect(deps?.dev).toContain('playwright-core')
        expect(deps?.dev).toContain('@nuxt/test-utils')
        expect(deps?.dev).toContain('vitest')
    })

    it('declares the Playwright test credential env vars', () => {
        const vars = playwrightFeature.collectEnv!(mockRunContext())
        const keys = vars?.map((v) => v.key)
        expect(keys).toContain('PLAYWRIGHT_TEST_EMAIL')
        expect(keys).toContain('PLAYWRIGHT_TEST_PASSWORD')
        const password = vars?.find((v) => v.key === 'PLAYWRIGHT_TEST_PASSWORD')
        expect(password?.secret).toBe(true)
    })

    it('requires shared:ai-tool-config (MCP entry emitted there)', () => {
        expect(playwrightFeature.requires).toContain('shared:ai-tool-config')
    })

    it('execute() is a no-op (MCP entry emitted by shared:ai-tool-config)', async () => {
        await expect(playwrightFeature.execute(mockRunContext())).resolves.toBeUndefined()
    })
})
