import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
    applyPlugin,
    BattlestackRegistries,
    defineBattlestackPlugin,
    finalizeRegistries,
    type Feature,
} from '@battlestack/core'

import { aiToolConfigFeature } from '../src/features/ai-tool-config.js'
import { playwrightFeature } from '../src/features/playwright.js'
import { nuxtUiFeature } from '../src/features/nuxt-ui.js'
import { mockRunContext } from './test-utils.js'

/**
 * READ BEFORE EDITING: these registries MUST come through the real `finalizeRegistries`
 * path. A hand-built set makes bare == fqid, so this suite passes with and without the bug.
 */

let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-mcp-test-'))
})

afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
})

/** The real loader path, same as the CLI runs at startup. */
function realRegistries(features: Feature[]): BattlestackRegistries {
    const registries = new BattlestackRegistries()
    const extensions = applyPlugin(
        defineBattlestackPlugin({
            name: '@battlestack/preset-nuxt4',
            apiVersion: 1,
            namespace: 'nuxt4',
            register(battlestack) {
                for (const f of features) battlestack.addFeature(f)
            },
        }),
        'bundled',
        registries,
    ).extensions
    const warnings = finalizeRegistries(registries, extensions)
    // An unexpected finalize warning means the fixture isn't the shape we think.
    expect(warnings).toEqual([])
    return registries
}

function ctxWith(features: Feature[]) {
    const registries = realRegistries(features)
    // fqids straight off the finalized registry, never hand-spelled.
    const enabledFeatures = new Set(features.map(f => registries.features.get(f.id).fqid))
    return {
        ctx: mockRunContext({
            projectDir,
            registries,
            enabledFeatures,
            framework: { id: 'nuxt4', label: 'Nuxt', supportedFeatures: [] },
            state: { packageManager: 'pnpm', aiTool: 'claude-code' },
        }),
        enabledFeatures,
    }
}

async function mcpServers(): Promise<Record<string, unknown>> {
    const raw = await readFile(path.join(projectDir, '.mcp.json'), 'utf8')
    return JSON.parse(raw).mcpServers
}

describe('.mcp.json server gating', () => {
    it('the fixture is in production shape: 3-segment fqids, not authored bare ids', () => {
        const { enabledFeatures } = ctxWith([playwrightFeature])
        const ids = [...enabledFeatures]
        expect(ids).toEqual(['nuxt4:shared:playwright'])
        // If this ever collapses to 2 segments, every assertion below silently stops
        // distinguishing bug from fix.
        for (const id of ids) expect(id.split(':')).toHaveLength(3)
    })

    it('registers the Playwright MCP server when shared:playwright is enabled', async () => {
        const { ctx } = ctxWith([aiToolConfigFeature, playwrightFeature])
        await aiToolConfigFeature.execute(ctx)

        const servers = await mcpServers()
        expect(Object.keys(servers)).toContain('playwright')
        expect(servers.playwright).toMatchObject({ args: ['-y', '@playwright/mcp@latest'] })
    })

    it('omits the Playwright MCP server when shared:playwright is not enabled', async () => {
        const { ctx } = ctxWith([aiToolConfigFeature])
        await aiToolConfigFeature.execute(ctx)

        expect(Object.keys(await mcpServers())).not.toContain('playwright')
    })

    it('gates nuxt-ui the same way, so the playwright case is not a one-off', async () => {
        const { ctx: withUi } = ctxWith([aiToolConfigFeature, nuxtUiFeature])
        await aiToolConfigFeature.execute(withUi)
        expect(Object.keys(await mcpServers())).toContain('nuxt-ui')

        await rm(path.join(projectDir, '.mcp.json'))
        const { ctx: withoutUi } = ctxWith([aiToolConfigFeature])
        await aiToolConfigFeature.execute(withoutUi)
        expect(Object.keys(await mcpServers())).not.toContain('nuxt-ui')
    })

    it('always registers the nuxt docs server for a nuxt4 framework', async () => {
        const { ctx } = ctxWith([aiToolConfigFeature])
        await aiToolConfigFeature.execute(ctx)
        expect(Object.keys(await mcpServers())).toContain('nuxt')
    })
})
