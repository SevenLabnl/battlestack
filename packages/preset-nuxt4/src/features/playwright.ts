import { type EnvVar, type Feature } from '@battlestack/core'
import { STAGE } from '@battlestack/core/constants/stages.js'

/** Playwright MCP server registration. `shared:ai-tool-config` emits the `.mcp.json` entry. */
export const playwrightFeature: Feature = {
    id: 'shared:playwright',
    version: '1.0.1',
    label: 'Playwright MCP + test deps',
    description: 'Playwright MCP for AI browser testing plus vitest test utilities.',
    stage: STAGE.AI_TOOL_CONFIG,
    requires: ['shared:ai-tool-config'],
    failureIsNonFatal: true,

    collectDeps() {
        return {
            dev: [
                'playwright-core',
                '@nuxt/test-utils',
                '@vue/test-utils',
                'vitest',
                'happy-dom',
                '@vitest/coverage-v8',
            ],
        }
    },

    collectEnv(): EnvVar[] {
        return [
            {
                key: 'PLAYWRIGHT_TEST_EMAIL',
                example: 'test@example.com',
                group: 'Playwright',
                description: 'Used by the Playwright MCP server when asked to sign in.',
            },
            {
                key: 'PLAYWRIGHT_TEST_PASSWORD',
                example: 'replace-me',
                group: 'Playwright',
                secret: true,
            },
        ]
    },

    collectDocs() {
        return [
            {
                heading: 'Playwright',
                body: [
                    'Playwright MCP server is registered via `.mcp.json` (emitted by `shared:ai-tool-config`), so Claude/Cursor/etc can open a browser and click around to verify UI changes without a manual hand-off.',
                    '',
                    'Set `PLAYWRIGHT_TEST_EMAIL` and `PLAYWRIGHT_TEST_PASSWORD` in `.env` so the AI tool can sign in for protected pages.',
                    '',
                    'Vitest + happy-dom are also installed; run `pnpm test` for unit/integration tests.',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute() {
        // No-op. The MCP entry comes from `shared:ai-tool-config`, deps from collectDeps/collectEnv.
    },

    async update() {
        return { written: [], skipped: [], notes: [] }
    },
}
