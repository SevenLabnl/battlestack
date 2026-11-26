// Import-free so the admin API, the agent runtime and unit tests share one table.

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

const EFFORTS: readonly ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

export interface ReasoningSupport {
    /** Levels the model accepts as `reasoning_effort`, ascending. `none` is listed only when it turns thinking off. */
    levels: ReasoningEffort[]
    /** What the model does when `reasoning_effort` is omitted, or null when that is not documented. */
    defaultLevel: ReasoningEffort | null
}

/** The `capabilities` object a gateway may return per model on `/v1/models` (sluis.ai does). */
export interface GatewayReasoningCapabilities {
    reasoning_efforts?: string[] | null
    reasoning_off?: boolean | null
    reasoning_default?: string | null
}

const LOW_HIGH: ReasoningEffort[] = ['low', 'high']
const LOW_TO_HIGH: ReasoningEffort[] = ['low', 'medium', 'high']
const MINIMAL_TO_HIGH: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high']
const LOW_TO_XHIGH: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh']
const LOW_TO_MAX: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

function rule(levels: ReasoningEffort[], defaultLevel: ReasoningEffort | null, off = false): ReasoningSupport {
    return { levels: off ? ['none', ...levels] : levels, defaultLevel }
}

// Fallback for gateways that do not report levels, and for models a gateway reports as unknown.
// First match wins, so specific patterns come first. A model that matches nothing gets no selector.
// Deliberately absent: Kimi, DeepSeek and Grok 4 reason without a level to set.
const RULES: Array<[RegExp, ReasoningSupport]> = [
    // OpenAI
    [/^gpt-6\.1-terra/, rule(['minimal', ...LOW_TO_XHIGH], null, true)],
    [/^gpt-6/, rule(LOW_TO_XHIGH, null)],
    [/^gpt-5\.6/, rule(['minimal', ...LOW_TO_XHIGH], null, true)],
    [/^gpt-5\.[2-5](\b|-)/, rule(LOW_TO_XHIGH, 'none', true)],
    [/^gpt-5\.1(\b|-)/, rule(LOW_TO_HIGH, 'none', true)],
    [/^gpt-5(-mini|-nano)?(-\d{4}-\d{2}-\d{2})?$/, rule(MINIMAL_TO_HIGH, 'medium')],
    [/^(o3|o4-mini)(-\d{4}-\d{2}-\d{2})?$/, rule(LOW_TO_HIGH, 'medium')],
    [/^gpt-oss/, rule(LOW_TO_HIGH, 'medium')],
    // Anthropic, including Bedrock-style ids such as `eu.anthropic.claude-…`
    [/claude-(opus-5-5|fable-5|mythos-5)/, rule(LOW_TO_MAX, null)],
    [/claude-sonnet-5-5/, rule(LOW_TO_MAX, null, true)],
    [/claude-(opus-4|opus-5|sonnet-4-6|sonnet-5)/, rule(LOW_TO_MAX, 'none', true)],
    // Google
    [/^gemini-4-(hydrogen|neon)/, rule(LOW_TO_XHIGH, null)],
    [/^gemini-4/, rule(LOW_TO_HIGH, null)],
    [/^gemini-3\.[78]-flash/, rule(LOW_TO_HIGH, 'medium')],
    [/^gemini-3\.[156]-flash-lite/, rule(MINIMAL_TO_HIGH, 'minimal')],
    [/^gemini-3\.[56]-flash/, rule(MINIMAL_TO_HIGH, 'medium')],
    [/^gemini-3(\.1)?-pro/, rule(LOW_HIGH, 'high')],
    [/^gemini-3-flash/, rule(MINIMAL_TO_HIGH, 'high')],
    [/^gemini-3/, rule(LOW_TO_HIGH, null)],
    [/^gemini-2\.5-pro/, rule(MINIMAL_TO_HIGH, 'high')],
    [/^gemini-2\.5-flash/, rule(LOW_TO_HIGH, 'high', true)],
    [/^gemma-4/, rule(LOW_TO_HIGH, null, true)],
    // Mistral: only Large 4 takes a level; it rejects `none`.
    [/^mistral-large-(4|latest)/, rule(LOW_TO_HIGH, 'high')],
    // xAI
    [/^grok-3-mini/, rule(LOW_HIGH, null)],
    // Open-weight models as served by OpenAI-compatible hosts
    [/^glm-5/, rule(['low', 'high', 'max'], 'high')],
    [/^qwen3\.[56]/, rule(LOW_TO_HIGH, null, true)],
]

function bareName(modelId: string): string {
    return modelId.trim().toLowerCase().split('/').pop() ?? ''
}

function isEffort(value: unknown): value is ReasoningEffort {
    return typeof value === 'string' && (EFFORTS as readonly string[]).includes(value)
}

/** The table's answer for a model id in any stored form: `gateway/<provider>/<model>`, `<provider>/<model>` or bare. */
export function fallbackReasoningSupport(modelId: string): ReasoningSupport | null {
    const name = bareName(modelId)
    if (!name) return null
    return RULES.find(([match]) => match.test(name))?.[1] ?? null
}

/**
 * Reads a gateway's own answer. Returns undefined when the gateway does not know the levels,
 * so the caller falls back to the table, and null when it says there is no level to choose.
 */
export function gatewayReasoningSupport(caps: GatewayReasoningCapabilities | null | undefined): ReasoningSupport | null | undefined {
    if (!caps || !Array.isArray(caps.reasoning_efforts)) return undefined
    const efforts = caps.reasoning_efforts.filter((e): e is ReasoningEffort => isEffort(e) && e !== 'none')
    const levels: ReasoningEffort[] = caps.reasoning_off ? ['none', ...efforts] : efforts
    if (levels.length === 0) return null
    return { levels, defaultLevel: isEffort(caps.reasoning_default) ? caps.reasoning_default : null }
}

/** The gateway's answer when it has one, else the table's. */
export function resolveReasoningSupport(modelId: string, caps?: GatewayReasoningCapabilities | null): ReasoningSupport | null {
    const fromGateway = gatewayReasoningSupport(caps)
    const support = fromGateway === undefined ? fallbackReasoningSupport(modelId) : fromGateway
    // A model that is off by default and can only be turned off has nothing to choose.
    if (support && support.levels.every((l) => l === 'none') && support.defaultLevel === 'none') return null
    return support
}

/** The effort to send, or null to omit the field: an unset value or one the model does not accept. */
export function effectiveReasoningEffort(support: ReasoningSupport | null, stored: string | null | undefined): ReasoningEffort | null {
    if (!stored || !support) return null
    return support.levels.find((level) => level === stored) ?? null
}
