import { closeDb } from '#server/database/client'

export default defineNitroPlugin((nitroApp) => {
    nitroApp.hooks.hook('close', closeDb)

    const shutdown = async () => {
        await nitroApp.hooks.callHook('close')
        process.exit(0)
    }
    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)
})
