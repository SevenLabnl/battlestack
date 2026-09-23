import { isFeatureEnabled, STAGE, type Feature, type RunContext } from '@battlestack/core'
import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'
import { patchNuxtConfig } from '../utils/nuxt-config.js'

/** `/api/health` + probe split (`/live`, `/ready`) + runtimeConfig knobs. Picks `with-db` or `env-only` variant at scaffold time. */
export const healthFeature: Feature = {
    id: 'nuxt4:health',
    version: '1.4.0',
    label: 'Health endpoints (/api/health, /live, /ready)',
    frameworks: ['nuxt4'],
    stage: STAGE.BASE_CONFIG,

    collectDocs() {
        return [
            {
                heading: 'Health',
                body: [
                    'Three endpoints, because liveness and readiness answer different questions. The rule: a liveness probe must not depend on anything a restart cannot fix.',
                    '',
                    '- `GET /api/health/live` — liveness + startup probes. Checks nothing but the process; failing means the pod is restarted. Never add a dependency check here (a test guards this).',
                    '- `GET /api/health/ready` — readiness probe. Checks env config, plus a Postgres ping with `nuxt4:database`; failing takes the pod out of the Service and reverses on its own. Only applicable config gates: the session password is checked only when `nuxt4:auth` is installed.',
                    '  With `nuxt4:database` it also answers 503 until every boot task in `server/utils/boot-tasks.ts` has settled (migrate-on-boot and the boot-time syncs), and keeps answering 503 if the migration failed. Nitro starts serving before async plugins finish, so this is what keeps a new pod out of the Service while it migrates. Register your own boot work with `runBootTask` rather than an unawaited async plugin.',
                    '- `GET /api/health` — humans and monitoring. Returns `{ status, version, checks }`; wired to no probe.',
                    '',
                    '- `/api/health` answers 200 when ok; 503 when degraded AND `runtimeConfig.health.failOnDegraded` is true (default).',
                    '- DB pings (when `nuxt4:database` is enabled) are bounded by `runtimeConfig.health.dbTimeoutMs` (default 1000ms) — shared by `/api/health` and `/api/health/ready`.',
                    '- Override per env via `NUXT_HEALTH_FAIL_ON_DEGRADED` and `NUXT_HEALTH_DB_TIMEOUT_MS`.',
                    '',
                    'The `version` field reads `runtimeConfig.public.appVersion`, which defaults to `dev`. Set `NUXT_PUBLIC_APP_VERSION` in the container environment (from the CI build number) to have a deployed app report what it is running; without it every environment reports `dev`.',
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
        c
            .mergeRuntimeConfig({
                health: { failOnDegraded: true, dbTimeoutMs: 1000 },
            })
            // Declared so `NUXT_PUBLIC_APP_VERSION` can override it; Nuxt ignores env for keys
            // absent from runtimeConfig.
            .setRuntimePublicDefault('appVersion', 'dev'),
    )
}
