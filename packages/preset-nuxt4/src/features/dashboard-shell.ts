import { STAGE, type Feature, type RunContext } from '@battlestack/core'
import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'
import { patchNuxtConfig } from '../utils/nuxt-config.js'

/** Authenticated app shell under `/dashboard/*`. */
export const dashboardShellFeature: Feature = {
    id: 'nuxt4:dashboard-shell',
    version: '1.3.1',
    label: 'Authenticated app shell (/dashboard/*)',
    frameworks: ['nuxt4'],
    stage: STAGE.AUTH,
    requires: ['nuxt4:auth', 'nuxt4:nuxt-ui'],
    failureIsNonFatal: true,

    collectDeps() {
        // `security.vue` imports `qrcode` unconditionally, so it is declared here, not in auth-2fa.
        return { prod: ['qrcode'], dev: ['@types/qrcode'] }
    },

    collectDocs() {
        return [
            {
                heading: 'App shell',
                body: [
                    'Authenticated routes live under `/dashboard/*` with the dashboard layout (`app/layouts/dashboard.vue`).',
                    '',
                    '- `/dashboard`: landing dashboard',
                    '- `/dashboard/profile`: read-only profile',
                    '- `/dashboard/security`: passkey + 2FA management. Sections auto-show when the corresponding feature is installed (`nuxt4:auth-passkeys`, `nuxt4:auth-2fa`).',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute(ctx) {
        await emitTemplate(ctx, 'nuxt4:dashboard-shell', import.meta.url, 'dashboard-shell')
        await patchViteOptimize(ctx)
        await patchDashboardFlag(ctx)
    },

    async update(ctx, prev) {
        const result = await emitTemplateUpdate(
            ctx,
            'nuxt4:dashboard-shell',
            import.meta.url,
            'dashboard-shell',
            prev,
        )
        await patchViteOptimize(ctx)
        await patchDashboardFlag(ctx)
        return result
    },
}

/** Tells the landing-shell header that `/dashboard` exists. */
async function patchDashboardFlag(ctx: RunContext): Promise<void> {
    await patchNuxtConfig(ctx.projectDir, (c) => c.mergeRuntimePublic({ dashboard: true }))
}

// Pre-bundles `qrcode`, which is CJS.
async function patchViteOptimize(ctx: RunContext): Promise<void> {
    await patchNuxtConfig(ctx.projectDir, (c) => c.addViteOptimizeIncludes(['qrcode']))
}
