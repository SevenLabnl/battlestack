import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { applyPlugin, BattlestackRegistries, finalizeRegistries } from '@battlestack/core'
import preset from '../src/index.js'
import { authFeature } from '../src/features/auth.js'
import { mockRunContext } from './test-utils.js'

let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-auth-session-header-'))
})
afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
})

it('refuses the session header without dropping the project\'s own session keys', async () => {
    // The revocation middleware only checks the cookie; h3 would otherwise accept the
    // sealed session from `x-nuxt-session-session` and skip that check.
    await writeFile(
        path.join(projectDir, 'nuxt.config.ts'),
        'export default defineNuxtConfig({\n    runtimeConfig: { session: { maxAge: 3600 } },\n})\n',
    )
    const registries = new BattlestackRegistries()
    const { extensions } = applyPlugin(preset, 'bundled', registries)
    expect(finalizeRegistries(registries, extensions)).toEqual([])
    await authFeature.execute(mockRunContext({
        projectDir,
        registries,
        framework: registries.frameworks.get('nuxt4'),
        template: registries.templates.get('nuxt4-fullstack'),
        enabledFeatures: new Set([registries.features.get('nuxt4:auth').fqid]),
        state: { packageManager: 'pnpm' },
    }))

    const config = await readFile(path.join(projectDir, 'nuxt.config.ts'), 'utf8')
    expect(config).toMatch(/session:\s*\{\s*maxAge: 3600,\s*password: '',\s*sessionHeader: false,?\s*\}/)
})
