import { Mastra } from '@mastra/core'
import { PinoLogger } from '@mastra/loggers'
import { PostgresStore } from '@mastra/pg'
import { Observability, DefaultExporter } from '@mastra/observability'
import { defaultAgent } from './agents/default'
import { LiteLLMGateway } from './gateways/litellm'

/**
 * Shared by Nuxt server routes and the standalone `mastra dev` Studio process, so it reads `process.env`: `useRuntimeConfig()` is undefined outside Nitro.
 * Threads and traces persist to the project's Postgres, keeping Studio's history and traces tabs populated across restarts.
 */
const databaseUrl = process.env.NUXT_DATABASE_URL
if (!databaseUrl) {
    throw new Error('NUXT_DATABASE_URL is not set in `.env`.')
}

const storage = new PostgresStore({
    id: 'mastra-storage',
    connectionString: databaseUrl,
    schemaName: 'mastra',
})

export const mastra = new Mastra({
    agents: { default: defaultAgent },
    // Every `<provider>/<model>` request routes through this gateway; discovery hits `/v1/models` at runtime so any provider LiteLLM serves is registered automatically.
    gateways: { litellm: new LiteLLMGateway() },
    storage,
    logger: new PinoLogger({ name: 'mastra', level: 'info' }),
    observability: new Observability({
        configs: {
            default: {
                serviceName: process.env.NUXT_PROJECT_NAME ?? 'app',
                exporters: [new DefaultExporter()],
            },
        },
    }),
})
