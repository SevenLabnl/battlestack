import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { STAGE, isFeatureEnabled, hashFile, rebaselineRecordedFile, recordFile, type Feature, type RunContext } from '@battlestack/core'
import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'
import { applyColorAliases } from './battlestack-theme.js'

/** Frontend shell: `app.vue`, `app.config.ts`, layouts, landing page. All emitted files are structural. */
export const landingShellFeature: Feature = {
    id: 'nuxt4:landing-shell',
    version: '1.4.0',
    label: 'Landing shell (layouts, public landing page)',
    description: 'Public landing page, layouts, and frontend app shell.',
    frameworks: ['nuxt4'],
    stage: STAGE.BASE_CONFIG,
    after: ['nuxt4:nuxt-ui'],

    async execute(ctx) {
        await emitTemplate(ctx, this.id, import.meta.url, 'landing-shell')
        await applyVariants(ctx, this.id)
        if (isFeatureEnabled(ctx, 'nuxt4:battlestack-theme')) await applyColorAliases(ctx)
    },

    structuralFiles(ctx) {
        const files
            = (ctx.state[`files:${this.id}`] as Record<string, string> | undefined) ?? {}
        return Object.keys(files)
    },

    async update(ctx, prev) {
        const report = await emitTemplateUpdate(ctx, this.id, import.meta.url, 'landing-shell', prev)
        await applyVariants(ctx, this.id)
        if (isFeatureEnabled(ctx, 'nuxt4:battlestack-theme')) await applyColorAliases(ctx)
        return report
    },
}

// Session UI sits between `battlestack:auth` markers, dropped when `nuxt4:auth` is off.
const NO_AUTH_SCRIPT_STUB = [
    '// No auth feature installed: landing shell renders without session UI.',
    'const isAdmin = computed(() => false)',
    '',
].join('\n')

/**
 * Keeps or drops a `<!-- battlestack:<name> -->` … `<!-- /battlestack:<name> -->` block.
 *
 * Dropping also takes one blank line above the opening marker, so removing a block that
 * was separated from its neighbour does not leave the separator behind.
 */
function applyMarkerBlock(content: string, name: string, enabled: boolean): string {
    if (enabled) {
        return content.replaceAll(new RegExp(`[ \\t]*<!-- /?battlestack:${name} -->\\n`, 'g'), '')
    }
    return content.replace(
        new RegExp(
            `(?:^[ \\t]*\\n)?[ \\t]*<!-- battlestack:${name} -->\\n[\\s\\S]*?<!-- /battlestack:${name} -->\\n`,
            'm',
        ),
        '',
    )
}

async function applyVariants(ctx: RunContext, featureId: string): Promise<void> {
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

    // `<AppBuildInfo>` comes from `nuxt4:build-info`; without it the component does not
    // exist and Nuxt renders an unresolved tag rather than failing the build.
    content = applyMarkerBlock(content, 'build-info', isFeatureEnabled(ctx, 'nuxt4:build-info'))

    await writeFile(file, content, 'utf8')
    const hash = await hashFile(file)
    recordFile(ctx, featureId, rel, hash)
    // `nuxt4:nuxt-ui` ships (and records) its own `default.vue` that this feature's
    // template just overwrote; the patch above changes the bytes again, so every
    // tracking feature's baseline has to move with them.
    rebaselineRecordedFile(ctx, rel, hash)
}
