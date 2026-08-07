import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { STAGE, isFeatureEnabled, hashFile, recordFile, type Feature, type RunContext } from '@battlestack/core'
import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'

/** Frontend shell: `app.vue`, `app.config.ts`, layouts, landing page. All emitted files are structural. */
export const landingShellFeature: Feature = {
    id: 'nuxt4:landing-shell',
    version: '1.3.1',
    label: 'Landing shell (layouts, public landing page)',
    description: 'Public landing page, layouts, and frontend app shell.',
    frameworks: ['nuxt4'],
    stage: STAGE.BASE_CONFIG,
    after: ['nuxt4:nuxt-ui'],

    async execute(ctx) {
        await emitTemplate(ctx, this.id, import.meta.url, 'landing-shell')
        await applyAuthVariant(ctx, this.id)
    },

    structuralFiles(ctx) {
        const files
            = (ctx.state[`files:${this.id}`] as Record<string, string> | undefined) ?? {}
        return Object.keys(files)
    },

    async update(ctx, prev) {
        const report = await emitTemplateUpdate(ctx, this.id, import.meta.url, 'landing-shell', prev)
        await applyAuthVariant(ctx, this.id)
        return report
    },
}

// Session UI sits between `battlestack:auth` markers, dropped when `nuxt4:auth` is off.
const NO_AUTH_SCRIPT_STUB = [
    '// No auth feature installed: landing shell renders without session UI.',
    'const isAdmin = computed(() => false)',
    '',
].join('\n')

async function applyAuthVariant(ctx: RunContext, featureId: string): Promise<void> {
    const rel = 'app/layouts/default.vue'
    const file = path.join(ctx.projectDir, rel)
    let content = await readFile(file, 'utf8')

    if (isFeatureEnabled(ctx, 'nuxt4:auth')) {
        content = content
            .replaceAll(/[ \t]*<!-- \/?battlestack:auth -->\n/g, '')
            .replaceAll(/[ \t]*\/\/ \/?battlestack:auth\n/g, '')
    } else {
        content = content
            .replace(/[ \t]*<!-- battlestack:auth -->\n[\s\S]*?<!-- \/battlestack:auth -->\n/, '')
            .replace(/\/\/ battlestack:auth\n[\s\S]*?\/\/ \/battlestack:auth\n/, NO_AUTH_SCRIPT_STUB)
    }

    await writeFile(file, content, 'utf8')
    recordFile(ctx, featureId, rel, await hashFile(file))
}
