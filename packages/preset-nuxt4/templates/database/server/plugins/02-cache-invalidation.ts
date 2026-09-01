import { sql } from '#server/database/client'
import {
    CACHE_INVALIDATION_CHANNEL,
    applyRemoteInvalidation,
    dropAllLocal,
} from '#server/utils/cache-bus'

/**
 * Subscribes this replica to cross-replica cache invalidations. Without it each replica
 * serves its own caches until they expire, so an admin edit on one is invisible on the rest
 * for up to the cache TTL.
 *
 * postgres-js keeps a dedicated connection for listeners and re-issues LISTEN after a drop,
 * so the third callback fires on the first connect and on every reconnect.
 */
export default defineNitroPlugin(() => {
    // Not awaited: boot must not block on the listener connecting. Until it does, and again
    // if it drops, caches fall back to expiring on their TTL.
    void sql
        .listen(
            CACHE_INVALIDATION_CHANNEL,
            (payload) => applyRemoteInvalidation(payload),
            () => dropAllLocal(),
        )
        .catch((err) => {
            console.error('[cache-bus] LISTEN failed, falling back to TTL-only invalidation:', err)
        })
})
