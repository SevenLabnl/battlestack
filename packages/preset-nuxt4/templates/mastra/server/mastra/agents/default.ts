import { Agent } from '@mastra/core/agent'
// Relative imports so `mastra dev` (standalone bundler) can resolve these too;
// `#server/*` is a Nuxt/Nitro alias that doesn't exist inside Mastra's bundle.
import { getAgentModelId, getAgentInstructions } from '../utils/agent-runtime'

// Model and instructions resolve per-call from the `agents` row, editable at `/dashboard/settings/ai` with no redeploy, falling back to code defaults.
// Studio's picker may visually deselect after overriding the model (dropdown key vs parsed provider); the call still routes correctly.
export const defaultAgent = new Agent({
    id: 'default',
    name: 'default',
    instructions: () => getAgentInstructions('default'),
    model: () => getAgentModelId('default'),
})
