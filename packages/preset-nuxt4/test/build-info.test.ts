import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RunContext } from '@battlestack/core'

import { buildInfoFeature } from '../src/features/build-info.js'
import { landingShellFeature } from '../src/features/landing-shell.js'
import { mockRunContext } from './test-utils.js'

const templatesRoot = fileURLToPath(new URL('../templates', import.meta.url))
const LAYOUT_REL = 'app/layouts/default.vue'

let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-build-info-test-'))
    await writeFile(path.join(projectDir, 'nuxt.config.ts'), 'export default defineNuxtConfig({})\n', 'utf8')
})

afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
})

function ctx(enabled: string[]): RunContext {
    return mockRunContext({
        projectDir,
        enabledFeatures: new Set(enabled),
        state: { packageManager: 'pnpm' },
    })
}

/** The bytes `nuxt4:nuxt-ui` leaves behind, straight from its real template. */
async function seedNuxtUiLayout(): Promise<void> {
    for (const rel of ['app/app.vue', 'app/app.config.ts', LAYOUT_REL, 'app/pages/index.vue']) {
        const dest = path.join(projectDir, rel)
        await mkdir(path.dirname(dest), { recursive: true })
        await writeFile(dest, await readFile(path.join(templatesRoot, 'nuxt-ui', rel), 'utf8'), 'utf8')
    }
}

describe('buildInfoFeature: runtime config', () => {
    /**
     * Nuxt only lets `NUXT_PUBLIC_X` override a key that already exists in `runtimeConfig`.
     * Without these four declarations the image's env vars are silently ignored and every
     * deployment reports `dev` with no commit — the exact failure this feature exists to fix.
     */
    it('declares every key the image sets, so NUXT_PUBLIC_APP_* can override them', async () => {
        await buildInfoFeature.execute(ctx(['nuxt4:build-info']))

        const config = await readFile(path.join(projectDir, 'nuxt.config.ts'), 'utf8')
        for (const key of ['appVersion', 'appCommit', 'appBuiltAt', 'appRepoUrl']) {
            expect(config, key).toContain(key)
        }
    })

    it('leaves a version a project already set alone', async () => {
        await writeFile(
            path.join(projectDir, 'nuxt.config.ts'),
            'export default defineNuxtConfig({ runtimeConfig: { public: { appVersion: \'pinned\' } } })\n',
            'utf8',
        )

        await buildInfoFeature.execute(ctx(['nuxt4:build-info']))

        const config = await readFile(path.join(projectDir, 'nuxt.config.ts'), 'utf8')
        expect(config).toContain('pinned')
        expect(config).not.toContain('\'dev\'')
    })

    it('emits the composable, the footer component and both locale files', async () => {
        await buildInfoFeature.execute(ctx(['nuxt4:build-info']))

        for (const rel of [
            'app/composables/useBuildInfo.ts',
            'app/components/AppBuildInfo.vue',
            'i18n/locales/nl/build.json',
            'i18n/locales/en/build.json',
        ]) {
            await expect(readFile(path.join(projectDir, rel), 'utf8'), rel).resolves.toBeTruthy()
        }
    })
})

describe('landingShellFeature: the footer follows nuxt4:build-info', () => {
    it('renders <AppBuildInfo> when the feature is installed', async () => {
        await seedNuxtUiLayout()

        await landingShellFeature.execute(ctx(['nuxt4:landing-shell', 'nuxt4:nuxt-ui', 'nuxt4:build-info']))

        const layout = await readFile(path.join(projectDir, LAYOUT_REL), 'utf8')
        expect(layout).toContain('<AppBuildInfo />')
        // The markers are scaffolding for this patch, not something a project should inherit.
        expect(layout).not.toContain('battlestack:build-info')
    })

    /**
     * The disabled run is the test. `<AppBuildInfo>` only exists because `nuxt4:build-info`
     * emitted it; left in the layout without it, Nuxt renders an unresolved custom element
     * and the footer is a blank strip nobody notices until a release needs tracing.
     */
    it('drops the whole footer block when the feature is not installed', async () => {
        await seedNuxtUiLayout()

        await landingShellFeature.execute(ctx(['nuxt4:landing-shell', 'nuxt4:nuxt-ui']))

        const layout = await readFile(path.join(projectDir, LAYOUT_REL), 'utf8')
        expect(layout).not.toContain('AppBuildInfo')
        expect(layout).not.toContain('UFooter')
        expect(layout).not.toContain('battlestack:build-info')
        // And it takes its blank separator line with it.
        expect(layout).not.toMatch(/\n\n\s*<\/div>/)
    })
})
