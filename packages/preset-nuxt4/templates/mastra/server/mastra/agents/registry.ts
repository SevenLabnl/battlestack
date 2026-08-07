// The boot sync plugin registers a DB row for every agent on the Mastra instance, falling back to `chat`/no-prompt for any not listed here.
// Add an entry to ship an agent with a specific model config or prompt; `promptKey: null` uses `defaultInstructions` until an admin links one.

export interface AgentDefinition {
    key: string
    name: string
    description: string
    /** → `ai_model_configs.key`. */
    modelConfigKey: string
    /** → `prompts.key`, or null for an agent with no linked prompt. */
    promptKey: string | null
    /** Used when `promptKey` is null or the prompt can't be resolved. */
    defaultInstructions: string
}

export const FALLBACK_INSTRUCTIONS = 'You are a helpful assistant for this application.'

export function getAgentDefinitions(): AgentDefinition[] {
    return [
        {
            key: 'default',
            name: 'Default agent',
            description: 'General-purpose assistant used by chat and other features.',
            modelConfigKey: 'chat',
            promptKey: 'agent.default.system',
            defaultInstructions: FALLBACK_INSTRUCTIONS,
        },
    ]
}

/** Metadata for one agent key: explicit definition, or a sensible fallback. */
export function getAgentDefinition(key: string): AgentDefinition {
    return (
        getAgentDefinitions().find((d) => d.key === key) ?? {
            key,
            name: key,
            description: '',
            modelConfigKey: 'chat',
            promptKey: null,
            defaultInstructions: FALLBACK_INSTRUCTIONS,
        }
    )
}
