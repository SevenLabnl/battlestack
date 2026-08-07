import { postgresRateLimitCheck, setRateLimitStore } from '#server/utils/rate-limit'
import { createRedisIncr, redactRedisUrl } from '#server/utils/redis-client'
import { createRedisRateLimitStore } from '#server/utils/redis-rate-limit'

/**
 * `NUXT_REDIS_URL`'s presence is the whole trigger; there is deliberately no `NUXT_REDIS_ENABLED` that could disagree with it.
 * The boot log names the live store so a never-set or mistyped URL cannot pass for a working Redis acceleration.
 */
export default defineNitroPlugin(() => {
    const config = useRuntimeConfig()
    const url = String(config.redisUrl ?? '')

    if (!url) {
        console.log('[rate-limit] store: postgres only (NUXT_REDIS_URL not set)')
        return
    }

    const incr = createRedisIncr(url)
    const store = createRedisRateLimitStore(incr, postgresRateLimitCheck)
    setRateLimitStore(store)

    console.log(
        `[rate-limit] store: redis (primary) + postgres (failover) at ${redactRedisUrl(url)}`,
    )
})
