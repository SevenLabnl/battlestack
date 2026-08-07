import { allocatePort, STAGE, type EnvVar, type Feature } from '@battlestack/core'
import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'
import { patchNuxtConfig } from '../utils/nuxt-config.js'

/**
 * Runs `nuxt4:auth`'s rate limiter on Redis, failing over to Postgres via a circuit breaker.
 * Triggered by the presence of `NUXT_REDIS_URL`, not a flag.
 */
export const redisFeature: Feature = {
    id: 'nuxt4:redis',
    version: '1.0.0',
    label: 'Redis rate limiting (dedicated backend)',
    description: 'Runs the rate limiter on Redis, preconfigured: compose service, client, policies and a circuit breaker that fails over to Postgres automatically. Off by default: Postgres alone is already cross-replica correct, so this is for headroom under concentrated floods, not for correctness.',
    frameworks: ['nuxt4'],
    stage: STAGE.AUTH_EXTRAS,
    requires: ['nuxt4:auth'],
    // A scaffold stays usable on Postgres alone, so a failure here is non-fatal.
    failureIsNonFatal: true,

    collectDeps() {
        return {
            prod: ['ioredis'],
        }
    },

    collectDocs() {
        return [
            {
                heading: 'Redis rate limiting',
                body: [
                    'Runs `nuxt4:auth`\'s rate limiter on Redis (preconfigured client, compose service and circuit breaker) with automatic failover to Postgres. Redis answers the limit decision; Postgres takes over only when the breaker opens.',
                    '',
                    '**Optional, and that is a correctness statement.** Postgres alone is already cross-replica correct, which is exactly why this is opt-in rather than required. What Redis buys is behaviour under a *concentrated* flood: every request against one key hits one Postgres row, and row-level locking serializes those UPSERTs precisely when rejection should be cheapest. Redis keeps rejection O(1) under that load. See `server/utils/rate-limit.ts`\'s doc comment for the full reasoning.',
                    '',
                    '**Trigger: config presence.** There is no enabled flag; `NUXT_REDIS_URL` being set is what turns this on. Unset it (or run `battlestack remove nuxt4:redis`) and the project reverts to pure Postgres, no code change.',
                    '',
                    '**Circuit breaker, not a per-request fallback.** On the first failed Redis command, the breaker opens for ~30s: every rate-limit check during that window skips Redis entirely and goes straight to Postgres, with no per-request timeout tax. After ~30s the next check probes Redis again; success closes the breaker, failure re-opens it for another ~30s. `commandTimeout` is 200ms, so even a fully wedged (not just down) Redis fails fast enough that the breaker trips before a real request notices.',
                    '',
                    'The boot log names the active store, so an operator can tell which backend is live without reading source: `[rate-limit] store: redis (primary) + postgres (failover) at <url>`, or `[rate-limit] store: postgres only (NUXT_REDIS_URL not set)`.',
                    '',
                    'Dev backend: plain `redis:7-alpine` in the project\'s `docker-compose.yml` (no persistent volume, since rate-limit counters are short-TTL and safe to lose on a restart). `battlestack up` starts it.',
                    '',
                    'Exploitability during a breaker flip is bounded and not attacker-inducible: Redis and Postgres keep independent counters for the same key, so a flip can let at most 2× a policy\'s `max` through in one window, once. See `redis-rate-limit.ts`\'s doc comment for the full derivation.',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    collectEnv(ctx): EnvVar[] {
        const redisPort = allocatePort(ctx.projectName, 'redis')
        return [
            {
                key: 'NUXT_REDIS_URL',
                value: `redis://localhost:${redisPort}`,
                example: 'redis://:password@redis.example.com:6379',
                group: 'Redis',
                description: 'Presence-triggered: set → the limiter runs on Redis, failing over to Postgres via the circuit breaker. Unset → pure Postgres, same as without this feature. Safe to unset anywhere; Postgres alone is already correct.',
            },
            {
                key: 'REDIS_PORT',
                value: String(redisPort),
                example: '6379',
                group: 'Redis',
                description: 'Dev-only: host port mapped to the compose Redis container. Per-project to avoid collisions. Irrelevant in prod (managed Redis, or no Redis at all).',
            },
        ]
    },

    async execute(ctx) {
        await emitTemplate(ctx, 'nuxt4:redis', import.meta.url, 'redis')
        await registerRuntimeConfig(ctx.projectDir)
    },

    async update(ctx, prev) {
        const result = await emitTemplateUpdate(ctx, 'nuxt4:redis', import.meta.url, 'redis', prev)
        await registerRuntimeConfig(ctx.projectDir)
        return result
    },
}

// Declares the key `NUXT_REDIS_URL` binds onto.
async function registerRuntimeConfig(projectDir: string): Promise<void> {
    await patchNuxtConfig(projectDir, (c) =>
        c.mergeRuntimeConfig({
            redisUrl: '',
        }),
    )
}
