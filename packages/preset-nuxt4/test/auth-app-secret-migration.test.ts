import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyPlugin, BattlestackRegistries, finalizeRegistries } from '@battlestack/core'
import type { RunContext } from '@battlestack/core'
import { ui } from '@battlestack/tui'
import preset from '../src/index.js'
import { APP_SECRET_ACTION, authFeature, renameEnvKey } from '../src/features/auth.js'
import { mockRunContext } from './test-utils.js'

let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-auth-app-secret-'))
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

const pull = (ctx: RunContext, version = '1.10.9') => authFeature.update!(ctx, { id: 'nuxt4:nuxt4:auth', version, files: {} })
const read = (file: string) => readFile(path.join(projectDir, file), 'utf8')
const write = (file: string, content: string) => writeFile(path.join(projectDir, file), content)

const LEGACY_ENV = [
    '# Session',
    '# Used by nuxt-auth-utils to seal session cookies. Must be ≥ 32 chars.',
    `NUXT_SESSION_PASSWORD=${'a'.repeat(64)}`,
    '',
    '# Security',
    'NUXT_ALLOWED_ORIGINS=',
    '',
].join('\n')

describe('renameEnvKey', () => {
    it('renames the key, keeps its value and rewrites its own description', () => {
        const next = renameEnvKey(LEGACY_ENV)
        expect(next).toContain(`\nNUXT_APP_SECRET=${'a'.repeat(64)}\n`)
        expect(next).not.toContain('NUXT_SESSION_PASSWORD')
        expect(next).toContain('# Nuxt\'s app secret.')
        expect(next).toContain('# Session\n')
        expect(next).toContain('# Security\nNUXT_ALLOWED_ORIGINS=')
    })

    it('drops the legacy key when NUXT_APP_SECRET is already set', () => {
        const next = renameEnvKey(`NUXT_APP_SECRET=${'b'.repeat(64)}\n${LEGACY_ENV}`)
        expect(next).toContain(`NUXT_APP_SECRET=${'b'.repeat(64)}`)
        expect(next).not.toContain('NUXT_SESSION_PASSWORD')
        expect(next).not.toContain('Used by nuxt-auth-utils to seal')
    })

    it('leaves a commented-out legacy key and unrelated comments alone', () => {
        const raw = '# keep me\n# NUXT_SESSION_PASSWORD=old\nNUXT_ALLOWED_ORIGINS=\n'
        expect(renameEnvKey(raw)).toBe(raw)
    })
})

describe('pull from nuxt-auth-utils 0.5', () => {
    it('moves .env and .env.example to NUXT_APP_SECRET and reports the production step', async () => {
        await write('nuxt.config.ts', 'export default defineNuxtConfig({})\n')
        await write('.env', LEGACY_ENV)
        await write('.env.example', LEGACY_ENV.replace('a'.repeat(64), 'change-me'))
        const report = await pull(context())

        expect(await read('.env')).toContain(`NUXT_APP_SECRET=${'a'.repeat(64)}`)
        expect(await read('.env')).not.toContain('NUXT_SESSION_PASSWORD')
        expect(await read('.env.example')).toContain('NUXT_APP_SECRET=change-me')
        expect(report.actions).toContain(APP_SECRET_ACTION)
    })

    it('removes password and sessionHeader from the session config and keeps the project\'s own keys', async () => {
        await write('nuxt.config.ts', 'export default defineNuxtConfig({\n    runtimeConfig: { session: { maxAge: 3600, password: \'\', sessionHeader: false } },\n})\n')
        const report = await pull(context())

        const config = await read('nuxt.config.ts')
        expect(config).toMatch(/session:\s*\{\s*maxAge: 3600,?\s*\}/)
        expect(config).not.toContain('password')
        expect(config).not.toContain('sessionHeader')
        expect(report.actions).toContain(APP_SECRET_ACTION)
    })

    it('drops the nuxt-session cookie name that 0.6 replaces with nuxt-auth-session', async () => {
        await write('nuxt.config.ts', 'export default defineNuxtConfig({\n    runtimeConfig: { session: { name: \'nuxt-session\', maxAge: 3600 } },\n})\n')
        await pull(context())
        const config = await read('nuxt.config.ts')
        expect(config).not.toContain('nuxt-session')
        expect(config).toMatch(/session:\s*\{\s*maxAge: 3600,?\s*\}/)
    })

    it('keeps a cookie name of the project\'s own', async () => {
        await write('nuxt.config.ts', 'export default defineNuxtConfig({\n    runtimeConfig: { session: { name: \'acme-session\' } },\n})\n')
        await pull(context())
        expect(await read('nuxt.config.ts')).toContain('acme-session')
    })

    it('drops a session config left empty', async () => {
        await write('nuxt.config.ts', 'export default defineNuxtConfig({\n    runtimeConfig: { session: { password: \'\', sessionHeader: false } },\n})\n')
        await pull(context())
        expect(await read('nuxt.config.ts')).not.toMatch(/session:/)
    })

    it('reports the production step even when the local files were already moved', async () => {
        await write('nuxt.config.ts', 'export default defineNuxtConfig({\n    runtimeConfig: { session: { maxAge: 3600 } },\n})\n')
        await write('.env', `NUXT_APP_SECRET=${'a'.repeat(64)}\n`)
        const report = await pull(context())
        expect(report.actions).toContain(APP_SECRET_ACTION)
    })

    it.each(['1.11.0', '1.12.3', '2.0.0'])('reports nothing when the project was on auth %s already', async (version) => {
        await write('nuxt.config.ts', 'export default defineNuxtConfig({\n    runtimeConfig: { session: { maxAge: 3600 } },\n})\n')
        await write('.env', `NUXT_APP_SECRET=${'a'.repeat(64)}\n`)
        const report = await pull(context(), version)
        expect(report.actions ?? []).not.toContain(APP_SECRET_ACTION)
    })
})

it('no longer adds session defaults to a new project\'s config', async () => {
    await write('nuxt.config.ts', 'export default defineNuxtConfig({\n    runtimeConfig: { session: { maxAge: 3600 } },\n})\n')
    await authFeature.execute(context())
    const config = await read('nuxt.config.ts')
    expect(config).toMatch(/session:\s*\{\s*maxAge: 3600,?\s*\}/)
})

it('names nuxt.config.ts#runtimeConfig when it is not an object literal', async () => {
    await write('nuxt.config.ts', 'const runtimeConfig = {}\nexport default defineNuxtConfig({ runtimeConfig })\n')
    await expect(authFeature.execute(context())).rejects.toThrow(/nuxt\.config\.ts#runtimeConfig is not an object literal/)
})

it('warns about the public keys it cannot add under a non-literal runtimeConfig.public', async () => {
    await write('nuxt.config.ts', 'const pub = { appName: \'x\' }\nexport default defineNuxtConfig({\n    runtimeConfig: { public: pub },\n})\n')
    const warn = vi.spyOn(ui, 'warn').mockImplementation(() => {})
    await authFeature.execute(context())
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('nuxt.config.ts#runtimeConfig.public.allowRegistration'))
})

it('keeps the Nuxt 4.6 floor in package.json when auth is removed', () => {
    const ctx = context()
    const auth = ctx.registries.features.get('nuxt4:auth').fqid
    for (const template of ctx.registries.templates.all()) {
        const remaining = template.requiredFeatures
            .filter((id) => id !== auth && ctx.registries.features.has(id))
            .flatMap((id) => ctx.registries.features.get(id).collectDeps?.(ctx)?.prod ?? [])
        expect(remaining, template.id).toContain('nuxt@^4.6.0')
    }
})
