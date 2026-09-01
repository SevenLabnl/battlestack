// Relative import so `mastra dev` (standalone bundler) can resolve this file too;
// `#server/*` is a Nuxt/Nitro alias that doesn't exist inside Mastra's bundle.
import { sql } from '../database/client'

/** Postgres NOTIFY channel carrying cache invalidations between replicas. */
export const CACHE_INVALIDATION_CHANNEL = 'battlestack_cache_invalidate'

interface Entry<T> {
    value: T
    expires: number
}

export interface TtlCache<T> {
    get: (key: string) => T | undefined
    set: (key: string, value: T) => void
    /** Drops entries on this replica only. Cross-replica drops go through `invalidate`. */
    dropLocal: (key?: string) => void
}

/**
 * Every cache created by `createTtlCache`, keyed by namespace, so an incoming notification
 * can reach the right one. Rebound at module load only.
 */
const registry = new Map<string, TtlCache<unknown>>()

/**
 * A read-through cache whose entries expire after `ttlMs` and can be dropped across every
 * replica through `invalidate`. `namespace` must be unique per cache in the project.
 *
 * The TTL is the floor: it bounds staleness even when a notification is never delivered.
 */
export function createTtlCache<T>(namespace: string, ttlMs: number): TtlCache<T> {
    const entries = new Map<string, Entry<T>>()

    const cache: TtlCache<T> = {
        get(key) {
            const hit = entries.get(key)
            if (!hit) return undefined
            if (hit.expires <= Date.now()) {
                entries.delete(key)
                return undefined
            }
            return hit.value
        },
        set(key, value) {
            entries.set(key, { value, expires: Date.now() + ttlMs })
        },
        dropLocal(key) {
            if (key === undefined) entries.clear()
            else entries.delete(key)
        },
    }

    // Overwrites rather than rejects a repeat namespace: under dev HMR a consumer module is
    // re-evaluated while this one is not, and throwing there would break the dev server.
    // The preset test suite is what catches two features sharing a namespace.
    registry.set(namespace, cache as TtlCache<unknown>)
    return cache
}

/**
 * Drops a cache entry on this replica and broadcasts the drop to every other one.
 * Omit `key` to drop the whole namespace. Await it before returning from an admin write.
 *
 * A failed broadcast is logged, not thrown: the TTL still expires the entry, so the cost
 * is bounded staleness on other replicas, never a failed write or a wrong answer.
 */
export async function invalidate(namespace: string, key?: string): Promise<void> {
    registry.get(namespace)?.dropLocal(key)
    const payload = JSON.stringify({ ns: namespace, key: key ?? null })
    try {
        await sql`SELECT pg_notify(${CACHE_INVALIDATION_CHANNEL}, ${payload})`
    } catch (err) {
        console.error('[cache-bus] invalidation broadcast failed:', err)
    }
}

/** Applies one notification payload. Called by `server/plugins/02-cache-invalidation.ts`. */
export function applyRemoteInvalidation(payload: string): void {
    let parsed: { ns?: unknown, key?: unknown }
    try {
        parsed = JSON.parse(payload)
    } catch {
        return
    }
    if (typeof parsed.ns !== 'string') return
    const key = typeof parsed.key === 'string' ? parsed.key : undefined
    registry.get(parsed.ns)?.dropLocal(key)
}

/**
 * Drops every cache on this replica. Called each time the listener connects, because
 * notifications published while it was disconnected were never delivered.
 */
export function dropAllLocal(): void {
    for (const cache of registry.values()) cache.dropLocal()
}
