import path from 'node:path'
import pc from 'picocolors'
import { enabledHas, type BattlestackRegistries, type FeatureState, type Template } from '@battlestack/core'
import * as ui from './ui.js'

/** Prints resolved settings and feature-prompt answers before scaffold writes. */
export function printResolvedSettingsSummary(opts: {
    template: Template
    packageManager: string
    enabled: Set<string>
    projectDir: string
    state?: FeatureState
    /** Resolves authored ids (`nuxt4:mastra`) against the fqid-holding `enabled` set. */
    registries?: BattlestackRegistries
}): void {
    const { template, packageManager, enabled, projectDir, state, registries } = opts
    const has = (id: string): boolean => enabledHas(enabled, id, registries)
    const required = new Set(template.requiredFeatures)
    const defaults = new Set(template.defaultEnabledOptional ?? [])

    const requiredList: string[] = []
    const defaultOnList: string[] = []
    const userOnList: string[] = []
    const userOffList: string[] = []

    for (const id of enabled) {
        if (required.has(id)) requiredList.push(id)
        else if (defaults.has(id)) defaultOnList.push(id)
        else userOnList.push(id)
    }
    for (const id of defaults) {
        if (!enabled.has(id)) userOffList.push(id)
    }

    const rel = path.relative(process.cwd(), projectDir) || projectDir
    ui.kv([
        ['template', `${template.label} ${pc.dim('(' + template.id + ')')}`],
        ['pm', packageManager],
        ['dir', rel],
    ])

    printFeatureGroup('Required', requiredList, pc.dim)
    printFeatureGroup('Default on', defaultOnList, pc.green, '+')
    printFeatureGroup('User on', userOnList, pc.green, '+')
    printFeatureGroup('User off', userOffList, pc.yellow, '−')

    if (state) printAnswerSummary(state, has)
    ui.blank()
}

/** Groups features by `namespace:` prefix, strips the namespace, and wraps. */
function printFeatureGroup(
    title: string,
    ids: string[],
    badge: (s: string) => string,
    glyph?: string,
): void {
    if (ids.length === 0) return
    ui.blank()
    const count = pc.dim(`(${ids.length})`)
    const header = `${title} ${count}`
    ui.plain(`  ${header}`)

    const grouped = new Map<string, string[]>()
    for (const id of ids.toSorted((a, b) => a.localeCompare(b))) {
        const idx = id.indexOf(':')
        const ns = idx >= 0 ? id.slice(0, idx) : ''
        const name = idx >= 0 ? id.slice(idx + 1) : id
        const list = grouped.get(ns) ?? []
        list.push(name)
        grouped.set(ns, list)
    }

    const nsWidth = Math.max(...[...grouped.keys()].map((k) => k.length + 1))
    for (const [ns, names] of grouped) {
        const prefix = glyph ? `${badge(glyph)} ` : ''
        const label = pc.dim((ns + ':').padEnd(nsWidth))
        const wrapped = wrap(names.join(', '), 64)
        ui.plain(`    ${label}  ${prefix}${wrapped[0]}`)
        for (let i = 1; i < wrapped.length; i++) {
            ui.plain(`    ${' '.repeat(nsWidth)}  ${prefix}${wrapped[i]}`)
        }
    }
}

/** Greedy word-wrap on commas/spaces. */
function wrap(text: string, width: number): string[] {
    const tokens = text.split(/,\s*/)
    const lines: string[] = []
    let line = ''
    for (const t of tokens) {
        const next = line ? `${line}, ${t}` : t
        if (next.length > width && line) {
            lines.push(line + ',')
            line = t
        } else {
            line = next
        }
    }
    if (line) lines.push(line)
    return lines
}

function printAnswerSummary(state: FeatureState, has: (id: string) => boolean): void {
    const rows: Array<[string, string]> = []
    const aiTool = pickString(state.aiTool)
    if (aiTool) rows.push(['AI tool', aiTool])

    if (has('nuxt4:mastra')) {
        // Guarded like every sibling row: an unanswered preset (non-interactive run,
        // ESC-cancelled select) must not be presented as a sluis.ai choice.
        const preset = pickString(state.aiGatewayPreset)
        if (preset) {
            rows.push(['AI gateway', preset === 'sluis' ? 'sluis.ai' : 'custom (OpenAI-compatible)'])
        }
        const url = pickString(state.aiGatewayUrl)
        if (url) rows.push(['Gateway URL', url])
        const key = pickString(state.aiGatewayKey)
        rows.push([
            'Gateway key',
            key ? ui.maskSecret(key) : pc.dim('(blank, set later in .env)'),
        ])
        const chatModel = pickString(state.aiGatewayChatModel)
        if (chatModel) rows.push(['Chat model', chatModel])
    }

    if (has('nuxt4:rag')) {
        const emb = pickString(state.ragEmbeddingModel)
        if (emb) rows.push(['Embedding model', emb])
        const dims = pickNumber(state.ragDimensions)
        if (dims !== undefined) rows.push(['Embedding dims', String(dims)])
        const strategy = pickString(state.ragChunkingStrategy)
        if (strategy) rows.push(['Chunking', strategy])
        const chunk = pickNumber(state.ragChunkSize)
        const overlap = pickNumber(state.ragChunkOverlap)
        if (chunk !== undefined || overlap !== undefined) {
            rows.push(['Chunk size / overlap', `${chunk ?? '?'} / ${overlap ?? '?'} tokens`])
        }
        const topK = pickNumber(state.ragTopK)
        if (topK !== undefined) rows.push(['Top-K', String(topK)])
    }

    if (has('nuxt4:chat')) {
        const transport = pickString(state.chatTransport)
        if (transport) rows.push(['Chat transport', transport])
    }

    if (state.gatewayEnabled === true) {
        rows.push(['battlestack-gateway', 'on'])
    } else if (state.gatewayEnabled === false) {
        rows.push(['battlestack-gateway', pc.dim('off')])
    }

    if (rows.length === 0) return
    ui.blank()
    ui.plain(`  ${pc.dim('settings')}`)
    ui.kv(rows, '    ')
}

function pickString(v: unknown): string | undefined {
    return typeof v === 'string' && v.length > 0 ? v : undefined
}

function pickNumber(v: unknown): number | undefined {
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}
