import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'
import { patchNuxtConfig } from '../utils/nuxt-config.js'
import { saveFeatureState, STAGE, type Feature, type ChatTransport } from '@battlestack/core'

/** Streaming chat on Mastra's default agent. Transport from `state.chatTransport`. */
export const chatFeature: Feature = {
    id: 'nuxt4:chat',
    // 1.1.3: re-emitted for the now-async `rateLimit()`.
    version: '1.1.3',
    label: 'Streaming chat (Mastra)',
    description: 'WebSocket streaming chat UI backed by the Mastra default agent.',
    frameworks: ['nuxt4'],
    stage: STAGE.CHAT,
    requires: ['nuxt4:mastra'],
    failureIsNonFatal: true,

    collectDocs() {
        return [
            {
                heading: 'Chat',
                body: [
                    'Streaming chat backed by Mastra\'s `default` agent. Edit the agent in `server/mastra/agents/default.ts` to change the system prompt, model, or tools.',
                    '',
                    '- Page: `/chat`',
                    '- Composable: `useChatAgent()`',
                    '- Transport (default): `ws-nitro`, a Nitro `defineWebSocketHandler` at `/_ws` (currently behind `nitro.experimental.websocket = true` on Nuxt 4).',
                    '- Transport `http` (Vercel AI SDK chunked-stream) is shipped but WARNING: **not supported in production today**. Cloudflare\'s edge buffers it. Manual opt-in only; never auto-selected.',
                    '',
                    'Transport is fixed at scaffold time via `state.chatTransport` and reflected in the manifest. To switch, re-run `battlestack pull` with a new value; current files become `.battlestack.patch` artefacts if user-modified.',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute(ctx) {
        const transport = pickTransport(ctx.state.chatTransport)
        await emitTemplate(ctx, 'nuxt4:chat', import.meta.url, `chat/${transport}`)

        ctx.state.chatTransport = transport
        saveFeatureState(ctx, 'nuxt4:chat', 'chatTransport', transport)

        if (transport === 'ws-nitro') {
            await enableNitroWebSockets(ctx.projectDir)
        }
        await exposePublicFlag(ctx.projectDir)
    },

    async update(ctx, prev) {
        const transport = pickTransport(prev?.state?.chatTransport ?? ctx.state.chatTransport)
        const report = await emitTemplateUpdate(ctx, 'nuxt4:chat', import.meta.url, `chat/${transport}`, prev)
        await exposePublicFlag(ctx.projectDir)
        return report
    },
}

// `runtimeConfig.public.chat` gates the landing-shell layout's /chat nav entry.
async function exposePublicFlag(projectDir: string): Promise<void> {
    await patchNuxtConfig(projectDir, (c) => c.mergeRuntimePublic({ chat: true }))
}

function pickTransport(raw: unknown): ChatTransport {
    if (raw === 'ws-nitro' || raw === 'http') return raw
    return 'ws-nitro'
}

async function enableNitroWebSockets(projectDir: string): Promise<void> {
    await patchNuxtConfig(projectDir, (c) =>
        c.setNitro({ experimental: { websocket: true } }),
    )
}
