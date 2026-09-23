import { closeDb } from '#server/database/client'

/**
 * Nitro's node server already traps SIGTERM/SIGINT: it stops accepting, drains in-flight
 * requests for up to `NITRO_SHUTDOWN_TIMEOUT`, then runs `close`. Only hook in here.
 */
export default defineNitroPlugin((nitroApp) => {
    nitroApp.hooks.hook('close', closeDb)
})
