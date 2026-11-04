import { assertValidAppSecretUnlessDev } from '#server/utils/app-secret'

/**
 * Crashing the boot is the point: a rollout then blocks on the new pod while the old, working one keeps serving,
 * rather than both serving with logins silently broken. `00-` runs it before any other plugin does setup work.
 */
export default defineNitroPlugin(() => {
    assertValidAppSecretUnlessDev(import.meta.dev, String(useRuntimeConfig().appSecret ?? ''))
})
