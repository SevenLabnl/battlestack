import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, expect, it } from 'vitest'
import {
    applyPlugin,
    BattlestackRegistries,
    finalizeRegistries,
    hashFile,
} from '@battlestack/core'
import type { InstalledFeatureRecord, RunContext } from '@battlestack/core'
import preset from '../src/index.js'
import { authFeature } from '../src/features/auth.js'
import { userAdminFeature } from '../src/features/user-admin.js'
import { mockRunContext } from './test-utils.js'

const OLD_POLICY = path.join('server', 'utils', 'password-policy.ts')
const SHARED_POLICY = path.join('shared', 'utils', 'password-policy.ts')
let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-user-validation-'))
    await writeFile(path.join(projectDir, 'nuxt.config.ts'), 'export default defineNuxtConfig({})\n')
})
afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
})

function context(withUserAdmin = false): RunContext {
    const registries = new BattlestackRegistries()
    const { extensions } = applyPlugin(preset, 'bundled', registries)
    expect(finalizeRegistries(registries, extensions)).toEqual([])
    const enabled = withUserAdmin
        ? ['nuxt4:auth', 'nuxt4:user-admin', 'nuxt4:audit-log']
        : ['nuxt4:auth']
    return mockRunContext({
        projectDir,
        registries,
        framework: registries.frameworks.get('nuxt4'),
        template: registries.templates.get('nuxt4-fullstack'),
        enabledFeatures: new Set(enabled.map((id) => registries.features.get(id).fqid)),
        state: { packageManager: 'pnpm' },
    })
}

it('ships a usable browser-safe policy when user-admin is disabled', async () => {
    const ctx = context()
    await authFeature.execute(ctx)
    // Exercise the emitted module: its temporary output path is selected at runtime.
    const policy = await import(pathToFileURL(path.join(projectDir, SHARED_POLICY)).href)
    expect(policy.checkPasswordPolicy('Password123!')).toMatchObject({ valid: false, code: 'common' })
    expect(policy.checkPasswordPolicy('Birch7!Abcde')).toEqual({ valid: true })
    await expect(readFile(path.join(projectDir, OLD_POLICY))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('retires the pristine server policy during an auth/user-admin update and converges', async () => {
    const ctx = context(true)
    await mkdir(path.dirname(path.join(projectDir, OLD_POLICY)), { recursive: true })
    await writeFile(path.join(projectDir, OLD_POLICY), 'export const PASSWORD_MIN_LENGTH = 12\n')
    const previous: InstalledFeatureRecord = {
        id: 'nuxt4:nuxt4:auth',
        version: '1.10.0',
        files: { [OLD_POLICY]: await hashFile(path.join(projectDir, OLD_POLICY)) },
    }
    ctx.state['files:nuxt4:auth'] = { ...previous.files }

    await authFeature.update!(ctx, previous)
    await userAdminFeature.execute(ctx)
    await expect(readFile(path.join(projectDir, OLD_POLICY))).rejects.toMatchObject({ code: 'ENOENT' })
    const files = ctx.state['files:nuxt4:auth'] as Record<string, string>
    expect(files[OLD_POLICY]).toBeUndefined()
    expect(files[SHARED_POLICY]).toBe(await hashFile(path.join(projectDir, SHARED_POLICY)))
    const next: InstalledFeatureRecord = { ...previous, version: authFeature.version, files: { ...files } }
    const report = await authFeature.update!(ctx, next)
    expect(report.skipped).toEqual([])
    expect(await hashFile(path.join(projectDir, SHARED_POLICY))).toBe(files[SHARED_POLICY])
})

it('notes an owned old policy and test left beside the shared policy', async () => {
    const ctx = context()
    const oldTest = path.join('server', 'utils', 'password-policy.test.ts')
    await mkdir(path.dirname(path.join(projectDir, OLD_POLICY)), { recursive: true })
    await writeFile(path.join(projectDir, OLD_POLICY), 'export const PASSWORD_MIN_LENGTH = 10\n')
    await writeFile(path.join(projectDir, oldTest), "import './password-policy'\n")
    const previous: InstalledFeatureRecord = {
        id: 'nuxt4:nuxt4:auth',
        version: '1.10.0',
        files: {
            [OLD_POLICY]: await hashFile(path.join(projectDir, OLD_POLICY)),
            [oldTest]: await hashFile(path.join(projectDir, oldTest)),
        },
        ownedByUser: [OLD_POLICY, oldTest],
    }
    ctx.state['files:nuxt4:auth'] = { ...previous.files }

    const report = await authFeature.update!(ctx, previous)
    expect(await readFile(path.join(projectDir, OLD_POLICY), 'utf8')).toContain('10')
    expect(report.notes).toEqual(expect.arrayContaining([
        expect.stringContaining('server/utils/password-policy.ts still exists next to shared/utils/password-policy.ts'),
        expect.stringContaining('server/utils/password-policy.test.ts still exists'),
    ]))
})
