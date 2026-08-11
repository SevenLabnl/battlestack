import { Agent } from '@mastra/core/agent'
// Relative imports so `mastra dev` (standalone bundler) can resolve these too;
// `#server/*` is a Nuxt/Nitro alias that doesn't exist inside Mastra's bundle.
import { getActiveModelId } from '../utils/ai-model'

// Same DB-backed chat-model selector as the default agent.
// `getActiveModelId` returns the `gateway/`-prefixed form so Mastra routes through `OpenAICompatGateway`.
export const ragAgent = new Agent({
    id: 'rag',
    name: 'rag',
    instructions: [
        'You are a retrieval-augmented assistant.',
        'Answer questions using the provided context excerpts only.',
        'If the context does not contain the answer, say so plainly.',
        'Cite the source field of each excerpt you use.',
    ].join(' '),
    model: () => getActiveModelId('chat'),
})
