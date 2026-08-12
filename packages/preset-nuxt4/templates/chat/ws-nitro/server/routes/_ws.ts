import { mastra } from '#server/mastra'
import { gatewayConfigError } from '#server/mastra/gateways/openai-compat'

export default defineWebSocketHandler({
    async message(peer, message) {
        try {
            const payload = JSON.parse(typeof message === 'string' ? message : message.text())
            if (!Array.isArray(payload?.messages)) return

            // Fail fast before invoking Mastra so its retry loop + stack trace
            // doesn't spam server logs when env config is incomplete. The check lives in
            // the gateway module and resolves config exactly like the gateway itself will.
            const configError = gatewayConfigError()
            if (configError) {
                peer.send(JSON.stringify({
                    type: 'error',
                    code: configError.code,
                    message: configError.message,
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
