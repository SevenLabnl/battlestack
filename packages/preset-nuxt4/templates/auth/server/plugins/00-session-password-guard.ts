import { assertValidSessionPasswordUnlessDev } from '#server/utils/session-password'

/**
 * Crashing the boot is the point: a rollout then blocks on the new pod while the old, working one keeps serving,
 * rather than both serving with logins silently broken. `00-` runs it before any other plugin does setup work.
 */
export default defineNitroPlugin(() => {
    const config = useRuntimeConfig()
    const password = String((config.session as { password?: unknown } | undefined)?.password ?? '')
    assertValidSessionPasswordUnlessDev(import.meta.dev, password)
})
