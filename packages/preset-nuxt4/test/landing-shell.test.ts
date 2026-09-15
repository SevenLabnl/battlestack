import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashFile, type InstalledFeatureRecord, type RunContext } from '@battlestack/core'

import { nuxtUiFeature } from '../src/features/nuxt-ui.js'
import { landingShellFeature } from '../src/features/landing-shell.js'
import { mockRunContext } from './test-utils.js'

const FEATURE_ID = 'nuxt4:landing-shell'

// The rels both templates ship: landing-shell overwrites nuxt-ui's copies on scaffold.
const SHARED_RELS = [
    'app/app.vue',
    'app/app.config.ts',
    'app/layouts/default.vue',
    'app/pages/index.vue',
]

const templatesRoot = fileURLToPath(new URL('../templates', import.meta.url))

let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-landing-shell-test-'))
    await writeFile(path.join(projectDir, 'nuxt.config.ts'), 'export default defineNuxtConfig({})\n', 'utf8')
    // The state `nuxt4:nuxt-ui` leaves behind, straight from its real template so this
    // suite breaks when that template drifts instead of silently testing a stale copy.
    for (const rel of SHARED_RELS) {
        const dest = path.join(projectDir, rel)
        await mkdir(path.dirname(dest), { recursive: true })
        const content = await readFile(path.join(templatesRoot, 'nuxt-ui', rel), 'utf8')
        await writeFile(dest, content, 'utf8')
    }
})

afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
})

function ctx(): RunContext {
    return mockRunContext({
        projectDir,
        enabledFeatures: new Set([FEATURE_ID, 'nuxt4:nuxt-ui']),
        state: { packageManager: 'pnpm' },
    })
}

describe('landingShellFeature: overwritten files stay in baseline', () => {
    /**
     * Landing-shell's template deliberately overwrites four files `nuxt4:nuxt-ui`
     * emitted and recorded (and then string-patches `default.vue` again for the auth
     * variant). Without moving nuxt-ui's baselines to the new bytes, every fresh
     * scaffold gets four permanent "drifted" entries in `doctor` and staged
     * `.new`/`.patch` conflicts on every `pull` — verified here through
     * `nuxt4:nuxt-ui`'s real update path.
     */
    it('re-baselines nuxt-ui\'s recorded hashes for the shared app-shell files', async () => {
        const runCtx = ctx()
        // What `nuxt4:nuxt-ui` recorded at scaffold time, before landing-shell ran.
        // Platform-separated, exactly as the emit path records them (`app\...` on Windows).
        const nuxtUiFiles: Record<string, string> = {}
        for (const rel of SHARED_RELS) {
            nuxtUiFiles[path.join(rel)] = await hashFile(path.join(projectDir, rel))
        }
        runCtx.state['files:nuxt4:nuxt-ui'] = nuxtUiFiles

        await landingShellFeature.execute(runCtx)

        const recorded = runCtx.state['files:nuxt4:nuxt-ui'] as Record<string, string>
        for (const rel of SHARED_RELS) {
            expect(recorded[path.join(rel)], rel).toBe(await hashFile(path.join(projectDir, rel)))
        }

        // The proof that matters: nuxt-ui's own update sees no drift on the next pull.
        const prev: InstalledFeatureRecord = {
            id: 'nuxt4:nuxt-ui',
            version: nuxtUiFeature.version,
            files: { ...recorded },
        }
        const report = await nuxtUiFeature.update!(ctx(), prev)
        expect(report.skipped).toEqual([])
    })
})
