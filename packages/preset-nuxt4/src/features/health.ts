import { isFeatureEnabled, STAGE, type Feature, type RunContext } from '@battlestack/core'
import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'
import { patchNuxtConfig } from '../utils/nuxt-config.js'

/** `/api/health` route + runtimeConfig knobs. Picks `with-db` or `env-only` variant at scaffold time. */
export const healthFeature: Feature = {
    id: 'nuxt4:health',
    // 1.2.0: the env check names NUXT_SESSION_PASSWORD and checks its length.
    version: '1.2.0',
    label: 'Health endpoint (/api/health)',
    frameworks: ['nuxt4'],
    stage: STAGE.BASE_CONFIG,

    collectDocs() {
        return [
            {
                heading: 'Health',
                body: [
                    '`GET /api/health` returns `{ status, version, checks }`. Container-orchestrator liveness + readiness probes target this route.',
                    '',
                    '- 200 when ok; 503 when degraded AND `runtimeConfig.health.failOnDegraded` is true (default).',
                    '- DB ping (when `nuxt4:database` is enabled) is bounded by `runtimeConfig.health.dbTimeoutMs` (default 1000ms).',
                    '- Override per env via `NUXT_HEALTH_FAIL_ON_DEGRADED` and `NUXT_HEALTH_DB_TIMEOUT_MS`.',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute(ctx) {
        await emitTemplate(ctx, 'nuxt4:health', import.meta.url, `health/${variant(ctx)}`)
        await registerRuntimeConfig(ctx.projectDir)
    },

    async update(ctx, prev) {
        const report = await emitTemplateUpdate(
            ctx,
            'nuxt4:health',
            import.meta.url,
            `health/${variant(ctx)}`,
            prev,
        )
        await registerRuntimeConfig(ctx.projectDir)
        return report
    },
}

function variant(ctx: RunContext): 'with-db' | 'env-only' {
    return isFeatureEnabled(ctx, 'nuxt4:database') ? 'with-db' : 'env-only'
}

async function registerRuntimeConfig(projectDir: string): Promise<void> {
    await patchNuxtConfig(projectDir, (c) =>
        c.mergeRuntimeConfig({
            health: { failOnDegraded: true, dbTimeoutMs: 1000 },
        }),
    )
}
