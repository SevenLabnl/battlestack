import { z } from 'zod'
import { ingestText } from '#server/utils/rag'

const schema = z.object({
    title: z.string().min(1).max(500),
    source: z.string().min(1).max(2000),
    text: z.string().min(1).max(2_000_000),
    metadata: z.record(z.string(), z.unknown()).optional(),
})

export default defineEventHandler(async (event) => {
    await requireUserSession(event)
    const body = await readValidatedBody(event, schema.parse)
    return ingestText(body)
})
