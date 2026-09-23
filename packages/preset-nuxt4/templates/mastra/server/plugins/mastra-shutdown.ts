import { mastra } from '#server/mastra'

/** Flushes buffered traces and stops Mastra's workers when Nitro drains on SIGTERM. */
export default defineNitroPlugin((nitroApp) => {
    nitroApp.hooks.hook('close', async () => {
        await mastra.shutdown().catch((err: unknown) => {
            console.error('[mastra] shutdown failed:', err)
        })
    })
})
