import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { STAGE, exists, isFeatureEnabled, hashFile, ownedAnywhere, rebaselineRecordedFile, recordFile, updateLedger, type Feature, type RunContext } from '@battlestack/core'
import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'
import { applyColorAliases } from './battlestack-theme.js'

/** Frontend shell: `app.vue`, `app.config.ts`, layouts, landing page. All emitted files are structural. */
export const landingShellFeature: Feature = {
    id: 'nuxt4:landing-shell',
    version: '1.4.3',
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
        // The patches below bypass the drift-aware writer, so they honor ownership themselves.
        const owned = ctx.state.overwrite === true ? new Set<string>() : ownedAnywhere(ctx)
        if (!owned.has('app/layouts/default.vue')) await applyVariants(ctx, this.id)
        if (isFeatureEnabled(ctx, 'nuxt4:battlestack-theme') && !owned.has('app/app.config.ts')) await applyColorAliases(ctx)
        await suggestHeaderActions(ctx, prev?.version)
        return report
    },
}

const HEADER_ACTIONS_SINCE = '1.4.3'

/**
 * The layout is structural, so the project owns it and pull never adds the `#header-actions`
 * target to it. Lists the step once, on the pull that crosses the version that introduced it.
 */
async function suggestHeaderActions(ctx: RunContext, fromVersion: string | undefined): Promise<void> {
    if (!fromVersion || !isOlder(fromVersion, HEADER_ACTIONS_SINCE)) return
    const layout = path.join(ctx.projectDir, 'app', 'layouts', 'default.vue')
    if (!(await exists(layout))) return
    const content = await readFile(layout, 'utf8')
    if (!content.includes('<UHeader') || content.includes('header-actions')) return
    updateLedger(ctx).actions.push(
        'Optional: to let a page add an action to the app header with `<Teleport to="#header-actions" defer>`, add '
        + '`<div id="header-actions" class="contents" />` inside `<UHeader>` in `app/layouts/default.vue`, and '
        + '`:ui="{ center: \'flex\' }"` on `<UHeader>` so it shows on mobile (give the `UNavigationMenu` there `class="hidden lg:flex"`). '
        + 'Pull leaves the layout alone because it is yours.',
    )
}

function isOlder(version: string, than: string): boolean {
    const a = version.split('.').map(Number)
    const b = than.split('.').map(Number)
    for (let i = 0; i < 3; i++) {
        if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0)
    }
    return false
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
