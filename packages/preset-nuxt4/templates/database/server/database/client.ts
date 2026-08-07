import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

// `process.env`, not `useRuntimeConfig()`, because this module also runs outside Nitro (the `db:seed` runner via tsx),
// where `useRuntimeConfig` is undefined. Safe here: server bundles never substitute `process.env.*` at build time.
const url = process.env.NUXT_DATABASE_URL
if (!url) {
    throw new Error('NUXT_DATABASE_URL is not set in `.env`.')
}

const client = postgres(url, { max: 10 })
export const db = drizzle(client)

export async function closeDb(): Promise<void> {
    await client.end({ timeout: 5 })
}
