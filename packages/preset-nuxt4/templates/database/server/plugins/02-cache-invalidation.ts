import { sql } from '#server/database/client'
import {
    CACHE_INVALIDATION_CHANNEL,
    applyRemoteInvalidation,
    dropAllLocal,
} from '#server/utils/cache-bus'

/**
 * Subscribes this replica to cache invalidations. postgres-js re-issues LISTEN after a drop,
 * so the third callback fires on every (re)connect and clears what was missed meanwhile.
 */
export default defineNitroPlugin(() => {
    // Not awaited: until the listener connects, caches fall back to their TTL.
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
