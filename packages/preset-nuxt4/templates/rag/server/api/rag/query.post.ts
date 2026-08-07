import { z } from 'zod'
import { queryText } from '#server/utils/rag'

const schema = z.object({
    query: z.string().min(1).max(4000),
})

export default defineEventHandler(async (event) => {
    await requireUserSession(event)
    const { query } = await readValidatedBody(event, schema.parse)
    return queryText(query)
})
