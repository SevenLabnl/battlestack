import { z } from 'zod'
import { handleChatStream } from '@mastra/ai-sdk'
import { createUIMessageStreamResponse } from 'ai'
import { mastra } from '#server/mastra'
import { rateLimit, RATE_LIMIT_POLICIES } from '#server/utils/rate-limit'

const chatSchema = z.object({
    messages: z
        .array(
            z.object({
                role: z.enum(['system', 'user', 'assistant']),
                content: z.string().min(1).max(32_000),
            }),
        )
        .min(1)
        .max(200),
})

export default defineEventHandler(async (event) => {
    const { user } = await requireUserSession(event)

    await rateLimit(event, {
        name: 'chat',
        ...RATE_LIMIT_POLICIES.CHAT_MESSAGE,
        key: user.id,
    })

    const parsed = chatSchema.safeParse(await readBody(event))
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Validation failed',
            data: z.flattenError(parsed.error),
        })
    }

    // Fail fast before invoking Mastra so its retry loop + stack trace
    // doesn't spam server logs when env config is incomplete.
    const config = useRuntimeConfig(event)
    if (!config.litellmUrl) {
        throw createError({ statusCode: 503, statusMessage: 'NUXT_LITELLM_URL is not set' })
    }
    if (!config.litellmKey) {
        throw createError({ statusCode: 503, statusMessage: 'NUXT_LITELLM_KEY is not set' })
    }

    const stream = await handleChatStream({
        mastra,
        agentId: 'default',
        params: parsed.data,
    })

    return createUIMessageStreamResponse({ stream })
})
