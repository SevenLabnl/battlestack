import path from 'node:path'
import {
    hashFile,
    isFeatureEnabled,
    recordFile,
    type Feature,
    type RunContext,
    type AiTool,
} from '@battlestack/core'
import { copyTemplateDirRecorded, templatesDir, updateFromTemplateDir } from '@battlestack/core/utils/templates.js'
import { writeFileEnsured } from '@battlestack/core/utils/fs.js'
import { STAGE } from '@battlestack/core/constants/stages.js'

const SUPPORTED: AiTool[] = ['claude-code', 'gemini-cli', 'cursor', 'codex']

/** AI coding tool rules + MCP server scaffolding. Selection via `state.aiTool` (default: `claude-code`). */
export const aiToolConfigFeature: Feature = {
    id: 'shared:ai-tool-config',
    // 1.1.6: `.mcp.json` gained its Playwright entry, plus corrected rule globs.
    version: '1.1.8',
    label: 'AI coding tool config',
    stage: STAGE.AI_TOOL_CONFIG,

    // Gated on the plugin's id being registered, so a public build advertises no unshipped rule file.
    collectDocs(ctx) {
        const hasK8s = ctx.registries.features.has('shared:k8s')
        // Each entry matches the `globs:` frontmatter of its rule file.
        const rules = [
            '- `drizzle.mdc` (server/database/**/*.ts, drizzle.config.ts)',
            '- `vue.mdc` (*.vue)',
            '- `tailwind.mdc` (*.vue, *.css, app.config.ts, main.css)',
            '- `ts.mdc` (*.ts)',
            '- `i18n.mdc` (i18n/**/*.ts, *.vue)',
        ]
        if (hasK8s) rules.push('- `k8s.mdc` (k8s/**)')
        rules.push('- `postgres.mdc`, `security.mdc`, `global.mdc`')
        return [
            {
                heading: 'AI coding tool',
                body: [
                    'Curated rules for context-aware AI assistance live in `.claude/rules/` (or your tool\'s equivalent). Each rule has a glob pattern and is loaded by the assistant only when files matching the pattern are open.',
                    '',
                    'Currently shipping rules:',
                    '',
                    ...rules,
                    '',
                    'Feature-gated rules ship from the relevant feature: `mastra.mdc` (mastra), `realtime.mdc` (chat).',
                    '',
                    'MCP servers live in `.mcp.json` at the project root (Claude Code picks them up automatically). Entries are gated by the enabled feature set: `nuxt` (always for Nuxt projects), `nuxt-ui` (when `nuxt:nuxt-ui` is on), `mastra` (when `nuxt:mastra` is on), `playwright` (when `shared:playwright` is on).',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute(ctx) {
        const tool = pickTool(ctx.state.aiTool)
        ctx.state.aiTool = tool
        const src = templatesDir(import.meta.url, '..', '..', 'templates', 'ai-tool-config', tool)
        await copyTemplateDirRecorded(ctx, 'shared:ai-tool-config', src)
        await emitMcpJson(ctx)
    },

    async update(ctx, prev) {
        const tool = pickTool(prev?.state?.aiTool ?? ctx.state.aiTool)
        const src = templatesDir(import.meta.url, '..', '..', 'templates', 'ai-tool-config', tool)
        const report = await updateFromTemplateDir(ctx, 'shared:ai-tool-config', src, prev)
        await emitMcpJson(ctx)
        report.written.push('.mcp.json')
        return report
    },
}

function pickTool(raw: unknown): AiTool {
    if (typeof raw === 'string' && (SUPPORTED as string[]).includes(raw)) {
        return raw as AiTool
    }
    return 'claude-code'
}

/** Project-root `.mcp.json` aggregating MCP entries from the enabled feature set. Always overwritten. */
async function emitMcpJson(ctx: RunContext): Promise<void> {
    const mcpServers: Record<string, McpEntry> = {}

    if (ctx.framework.id === 'nuxt4') {
        mcpServers.nuxt = {
            command: 'npx',
            args: ['mcp-remote', 'https://nuxt.com/mcp'],
        }
    }

    if (isFeatureEnabled(ctx, 'nuxt4:nuxt-ui')) {
        mcpServers['nuxt-ui'] = {
            command: 'npx',
            args: ['mcp-remote', 'https://ui.nuxt.com/mcp'],
        }
    }

    if (isFeatureEnabled(ctx, 'nuxt4:mastra')) {
        mcpServers.mastra = {
            type: 'stdio',
            command: 'npx',
            args: ['-y', '@mastra/mcp-docs-server@latest'],
            env: {},
        }
    }

    if (isFeatureEnabled(ctx, 'shared:playwright')) {
        mcpServers.playwright = {
            command: 'npx',
            args: ['-y', '@playwright/mcp@latest'],
            env: {
                PLAYWRIGHT_TEST_EMAIL: '${PLAYWRIGHT_TEST_EMAIL}',
                PLAYWRIGHT_TEST_PASSWORD: '${PLAYWRIGHT_TEST_PASSWORD}',
            },
        }
    }

    const target = path.join(ctx.projectDir, '.mcp.json')
    await writeFileEnsured(target, JSON.stringify({ mcpServers }, null, 4) + '\n')
    recordFile(ctx, 'shared:ai-tool-config', '.mcp.json', await hashFile(target))
}

interface McpEntry {
    type?: 'stdio' | 'http' | 'sse'
    command: string
    args: string[]
    env?: Record<string, string>
}
