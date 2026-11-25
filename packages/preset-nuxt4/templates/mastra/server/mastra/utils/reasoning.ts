// Import-free so the admin API, the agent runtime and unit tests share one table.

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface ReasoningSupport {
    /** Levels the provider accepts as `reasoning_effort`. Sending anything else is a 400. */
    levels: ReasoningEffort[]
    /** What the provider does when `reasoning_effort` is omitted, or null when it does not document it. */
    defaultLevel: ReasoningEffort | null
}

interface Rule {
    match: RegExp
    support: ReasoningSupport
}

// First match wins, so more specific patterns come first. Extend this table to support more models;
// a model that matches nothing gets no selector and no `reasoning_effort` on the wire.
const RULES: Rule[] = [
    {
        match: /^mistral-large-(4|latest)/,
        support: { levels: ['low', 'medium', 'high'], defaultLevel: 'high' },
    },
    {
        match: /^gpt-5(-mini|-nano|-codex)?(-\d{4}-\d{2}-\d{2})?$/,
        support: { levels: ['minimal', 'low', 'medium', 'high'], defaultLevel: 'medium' },
    },
    {
        match: /^gpt-5\.1(\b|-)/,
        support: { levels: ['none', 'low', 'medium', 'high'], defaultLevel: 'none' },
    },
    {
        match: /^gpt-5\.([2-9]|\d{2,})(\b|-)/,
        support: { levels: ['none', 'low', 'medium', 'high', 'xhigh'], defaultLevel: 'none' },
    },
    {
        match: /^o(1|3|4)(-mini)?(\b|-)/,
        support: { levels: ['low', 'medium', 'high'], defaultLevel: 'medium' },
    },
]

/** Accepts every stored form: `gateway/<provider>/<model>`, `<provider>/<model>` or a bare name. */
export function reasoningSupport(modelId: string): ReasoningSupport | null {
    const name = modelId.trim().toLowerCase().split('/').pop() ?? ''
    if (!name) return null
    return RULES.find((r) => r.match.test(name))?.support ?? null
}

/** The effort to send, or null to omit the field: an unset value or one the model does not accept. */
export function effectiveReasoningEffort(modelId: string, stored: string | null | undefined): ReasoningEffort | null {
    if (!stored) return null
    const support = reasoningSupport(modelId)
    return support?.levels.find((level) => level === stored) ?? null
}
