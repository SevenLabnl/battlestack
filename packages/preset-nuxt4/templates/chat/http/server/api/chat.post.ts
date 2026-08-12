import { z } from 'zod'
import { handleChatStream } from '@mastra/ai-sdk'
import { createUIMessageStreamResponse } from 'ai'
import { mastra } from '#server/mastra'
import { gatewayConfigError } from '#server/mastra/gateways/openai-compat'
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
    // doesn't spam server logs when env config is incomplete. The check lives in the
    // gateway module and resolves config exactly like the gateway itself will.
    const configError = gatewayConfigError()
    if (configError) {
        throw createError({
            statusCode: 503,
            statusMessage: configError.message,
            data: { code: configError.code },
        })
    }

    const stream = await handleChatStream({
        mastra,
        agentId: 'default',
        params: parsed.data,
    })

    return createUIMessageStreamResponse({ stream })
})
