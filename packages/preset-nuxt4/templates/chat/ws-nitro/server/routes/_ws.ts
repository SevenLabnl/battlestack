import { mastra } from '#server/mastra'

export default defineWebSocketHandler({
    async message(peer, message) {
        try {
            const payload = JSON.parse(typeof message === 'string' ? message : message.text())
            if (!Array.isArray(payload?.messages)) return

            // Fail fast before invoking Mastra so its retry loop + stack trace
            // doesn't spam server logs when env config is incomplete.
            const config = useRuntimeConfig()
            if (!config.litellmUrl) {
                peer.send(JSON.stringify({
                    type: 'error',
                    message: 'NUXT_LITELLM_URL is not set',
                }))
                return
            }
            if (!config.litellmKey) {
                peer.send(JSON.stringify({
                    type: 'error',
                    message: 'NUXT_LITELLM_KEY is not set',
                }))
                return
            }

            const agent = mastra.getAgent('default')
            const stream = await agent.stream(payload.messages)

            for await (const chunk of stream.textStream) {
                peer.send(JSON.stringify({ type: 'delta', content: chunk }))
            }
            peer.send(JSON.stringify({ type: 'done' }))
        } catch (err) {
            peer.send(
                JSON.stringify({
                    type: 'error',
                    message: err instanceof Error ? err.message : 'unknown',
                }),
            )
        }
    },
})
