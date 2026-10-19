import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { applyPlugin, BattlestackRegistries, finalizeRegistries } from '@battlestack/core'
import type { RunContext } from '@battlestack/core'
import { ui } from '@battlestack/tui'
import preset from '../src/index.js'
import { authFeature } from '../src/features/auth.js'
import { mockRunContext } from './test-utils.js'

let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-auth-session-header-'))
})
afterEach(async () => {
    vi.restoreAllMocks()
    await rm(projectDir, { recursive: true, force: true })
})

function context(): RunContext {
    const registries = new BattlestackRegistries()
    const { extensions } = applyPlugin(preset, 'bundled', registries)
    expect(finalizeRegistries(registries, extensions)).toEqual([])
    return mockRunContext({
        projectDir,
        registries,
        framework: registries.frameworks.get('nuxt4'),
        template: registries.templates.get('nuxt4-fullstack'),
        enabledFeatures: new Set([registries.features.get('nuxt4:auth').fqid]),
        state: { packageManager: 'pnpm' },
    })
}

async function writeConfig(source: string): Promise<void> {
    await writeFile(path.join(projectDir, 'nuxt.config.ts'), source)
}

it('refuses the session header without dropping the project\'s own session keys', async () => {
    // The revocation middleware only checks the cookie; h3 would otherwise accept the
    // sealed session from `x-nuxt-session-session` and skip that check.
    await writeConfig('export default defineNuxtConfig({\n    runtimeConfig: { session: { maxAge: 3600 } },\n})\n')
    await authFeature.execute(context())

    const config = await readFile(path.join(projectDir, 'nuxt.config.ts'), 'utf8')
    expect(config).toMatch(/session:\s*\{\s*maxAge: 3600,\s*sessionHeader: false,?\s*\}/)
})

it.each([
    ['true', 1],
    ['process.env.ALLOW_HEADER === \'1\'', 1],
    ['false', 0],
])('keeps `sessionHeader: %s` on pull, with %i warning about it', async (value, warnings) => {
    await writeConfig(`export default defineNuxtConfig({\n    runtimeConfig: { session: { sessionHeader: ${value} } },\n})\n`)
    const warn = vi.spyOn(ui, 'warn').mockImplementation(() => {})
    await authFeature.update!(context(), { id: 'nuxt4:nuxt4:auth', version: '1.10.0', files: {} })

    const config = await readFile(path.join(projectDir, 'nuxt.config.ts'), 'utf8')
    expect(config).toContain(`sessionHeader: ${value}`)
    const about = warn.mock.calls.filter(([message]) => String(message).includes('session.sessionHeader is not'))
    expect(about).toHaveLength(warnings)
})

it('names nuxt.config.ts#runtimeConfig when it is not an object literal', async () => {
    await writeConfig('const runtimeConfig = {}\nexport default defineNuxtConfig({ runtimeConfig })\n')
    await expect(authFeature.execute(context())).rejects.toThrow(/nuxt\.config\.ts#runtimeConfig is not an object literal/)
})

it('warns about the session defaults it cannot add under a non-literal session', async () => {
    await writeConfig('const baseSession = { maxAge: 3600 }\nexport default defineNuxtConfig({\n    runtimeConfig: { session: baseSession },\n})\n')
    const warn = vi.spyOn(ui, 'warn').mockImplementation(() => {})
    await authFeature.execute(context())
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('nuxt.config.ts#runtimeConfig.session.sessionHeader'))
})
