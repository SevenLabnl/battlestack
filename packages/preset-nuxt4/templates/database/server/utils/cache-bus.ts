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
    /**
     * Invalidation counter. Capture it before loading a value and pass it to `set`, so a drop
     * that lands while the load is in flight is not overwritten by the value it invalidated.
     */
    generation: () => number
    /** Writes unless `atGeneration` is given and an invalidation has happened since. */
    set: (key: string, value: T, atGeneration?: number) => void
    /** Drops entries on this replica only. Cross-replica drops go through `invalidate`. */
    dropLocal: (key?: string) => void
}

/** Every cache created by `createTtlCache`, keyed by namespace, for incoming notifications. */
const registry = new Map<string, TtlCache<unknown>>()

/**
 * TTL cache droppable on every replica via `invalidate`; the TTL bounds staleness if a notification is lost.
 * Keys must come from a bounded set: an entry is evicted only when its own key is read after expiry.
 */
export function createTtlCache<T>(namespace: string, ttlMs: number): TtlCache<T> {
    const entries = new Map<string, Entry<T>>()
    let generation = 0

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
        generation: () => generation,
        set(key, value, atGeneration) {
            if (atGeneration !== undefined && atGeneration !== generation) return
            entries.set(key, { value, expires: Date.now() + ttlMs })
        },
        dropLocal(key) {
            generation++
            if (key === undefined) entries.clear()
            else entries.delete(key)
        },
    }

    // Overwrites a repeat namespace: dev HMR re-evaluates consumers, not this module.
    // Cross-feature collisions are caught by a static test instead.
    registry.set(namespace, cache as TtlCache<unknown>)
    return cache
}

/**
 * Drops an entry here and broadcasts the drop; omit `key` for the whole namespace.
 * A failed broadcast is only logged: the TTL still bounds staleness on the other replicas.
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
    let parsed: unknown
    try {
        parsed = JSON.parse(payload)
    } catch {
        return
    }
    // Valid JSON can still be null; postgres-js swallows a throw from this callback.
    if (typeof parsed !== 'object' || parsed === null) return
    const { ns, key: rawKey } = parsed as { ns?: unknown, key?: unknown }
    if (typeof ns !== 'string') return
    const key = typeof rawKey === 'string' ? rawKey : undefined
    registry.get(ns)?.dropLocal(key)
}

/**
 * Drops every cache on this replica. Called each time the listener connects, because
 * notifications published while it was disconnected were never delivered.
 */
export function dropAllLocal(): void {
    for (const cache of registry.values()) cache.dropLocal()
}
