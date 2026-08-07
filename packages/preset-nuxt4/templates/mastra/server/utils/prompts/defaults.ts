export interface DefaultPrompt {
    key: string
    name: string
    description: string
    defaultContent: string
}

export function getDefaultPrompts(): DefaultPrompt[] {
    return [
        {
            key: 'agent.default.system',
            name: 'Default agent system prompt',
            description:
                'Base system prompt every agent inherits unless it overrides with its own key.',
            defaultContent: [
                'You are a helpful, honest assistant. Keep replies focused and concise.',
                'When uncertain, say so rather than guessing.',
                'Cite sources or context when relevant.',
            ].join('\n'),
        },
    ]
}
