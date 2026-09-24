/**
 * Every Postgres advisory lock key used by this project, in one place so a new lock cannot
 * silently pick a value another one already holds. Keys share a single global namespace:
 * two unrelated call sites on the same key block each other.
 *
 * `tools/migrate.mjs` and `tools/seed.mjs` repeat their values as literals. They run outside
 * the Nuxt build and cannot import this file; both name the constant they must match.
 */
export const ADVISORY_LOCK = {
    /** `tools/migrate.mjs`, `server/plugins/00-db-migrate-on-boot.ts`. */
    MIGRATE: 6_154_321_001_001_001,
    /** `tools/seed.mjs`. */
    SEED: 6_154_321_001_001_002,
    /** `server/plugins/11-sync-prompts-on-boot.ts`, shipped by `nuxt4:prompts`. */
    SYNC_PROMPTS: 6_154_321_001_001_003,
    /** `server/plugins/10-sync-ai-on-boot.ts`, shipped by `nuxt4:mastra`. */
    SYNC_AI: 6_154_321_001_001_004,
} as const

export type AdvisoryLockName = keyof typeof ADVISORY_LOCK
