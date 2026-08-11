import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import {
    recordFile,
    type EnvVar,
    type EnvDiff,
    type Feature,
    type RunContext,
} from '@battlestack/core'
import { writeFileEnsured } from '@battlestack/core/utils/fs.js'
import { STAGE, STAGE_ORDER } from '@battlestack/core/constants/stages.js'

/**
 * Aggregates `EnvVar` contributions into `.env` (real values) and `.env.example` (placeholders).
 * Scaffold mode writes both; project mode is append-only for `.env`. First contribution wins.
 */
export const envFeature: Feature = {
    id: 'shared:env',
    version: '1.0.3',
    label: 'Write .env / .env.example',
    stage: STAGE.ENV,

    async execute(ctx) {
        const diff = await applyEnv(ctx)
        ctx.state['env:diff'] = diff
    },

    async update(ctx, _prev) {
        const diff = await applyEnv(ctx)
        ctx.state['env:diff'] = diff
        return { written: ['.env', '.env.example'], skipped: [], notes: [] }
    },
}

export interface ApplyEnvOptions {
    /** Write or refresh `.env.example` too. Default `true`. */
    writeExample?: boolean
}

/** Applies the env policy and returns the diff. */
export async function applyEnv(ctx: RunContext, opts: ApplyEnvOptions = {}): Promise<EnvDiff> {
    const writeExample = opts.writeExample ?? true
    const vars = collectAll(ctx)
    if (vars.length === 0) return { newKeys: [], valueChanged: [] }

    const envPath = path.join(ctx.projectDir, '.env')
    const examplePath = path.join(ctx.projectDir, '.env.example')
    const battlestackKeys = new Set(vars.map((v) => v.key))

    // An existing `.env.example` may carry keys battlestack doesn't declare. Those are preserved.
    const existingExample = await readFileOrNull(examplePath)
    const customEntries = existingExample
        ? extractCustomEntries(existingExample, battlestackKeys)
        : []
    const exampleContent = mergeExample(renderExample(vars), customEntries)

    // A single read, never a separate exists()/stat.
    const existingRaw = await readFileOrNull(envPath)

    if (existingRaw === null) {
        // battlestack keys get real dev values; keys from `.env.example` come back as placeholders.
        let envContent = renderEnv(vars, new Map())
        if (customEntries.length > 0) {
            envContent += `\n${ENV_CUSTOM_HEADER}\n`
                + customEntries.map((c) => c.block).join('\n') + '\n'
        }
        await writeFileEnsured(envPath, envContent)
        if (writeExample) {
            await writeFileEnsured(examplePath, exampleContent)
            recordFile(ctx, 'shared:env', '.env.example', sha256(exampleContent))
        }
        return { newKeys: [], valueChanged: [] }
    }

    // Project mode: existing keys are kept, only gaps filled.
    const existing = parseEnv(existingRaw)

    const newKeys: string[] = []
    const valueChanged: EnvDiff['valueChanged'] = []
    const toAppend: EnvVar[] = []
    // Self-owned secrets still on a placeholder are generated in place.
    const toRegenerate = new Map<string, string>()

    for (const v of vars) {
        if (existing.has(v.key)) {
            const current = (existing.get(v.key) ?? '').trim()
            // A generatable secret left as `change-me` or empty.
            if (v.generate && isPlaceholder(v, current)) {
                toRegenerate.set(v.key, generateSecret(v.generate))
                continue
            }
            // A key the user already set is never touched.
            if (current) continue
            // Empty non-secret with a real default: suggested, not overwritten.
            const recommended = resolveValue(v)
            if (recommended) {
                valueChanged.push({ key: v.key, current, recommended })
            }
        } else {
            toAppend.push(v)
            newKeys.push(v.key)
        }
    }

    // Keys in `.env.example` but missing from `.env` are appended too.
    const customToAppend = customEntries.filter((c) => !existing.has(c.key))

    if (toAppend.length > 0 || toRegenerate.size > 0 || customToAppend.length > 0) {
        // The pre-mutation file is backed up first.
        await writeFileEnsured(`${envPath}.battlestack.bak`, existingRaw)

        let nextRaw = rewriteEnvValues(existingRaw, toRegenerate)
        if (toAppend.length > 0) {
            const appended = renderEnv(toAppend, new Map())
            const sep = nextRaw.endsWith('\n') ? '' : '\n'
            nextRaw += `${sep}\n# Added by battlestack: please verify these values\n${appended}`
        }
        if (customToAppend.length > 0) {
            const sep = nextRaw.endsWith('\n') ? '' : '\n'
            nextRaw += `${sep}\n${ENV_CUSTOM_HEADER}\n`
                + customToAppend.map((c) => c.block).join('\n') + '\n'
            for (const c of customToAppend) newKeys.push(c.key)
        }
        await writeFileEnsured(envPath, nextRaw)
    }

    if (writeExample) {
        await writeFileEnsured(examplePath, exampleContent)
        recordFile(ctx, 'shared:env', '.env.example', sha256(exampleContent))
    }

    return { newKeys, valueChanged, regenerated: [...toRegenerate.keys()] }
}

async function readFileOrNull(p: string): Promise<string | null> {
    try {
        return await readFile(p, 'utf8')
    } catch {
        return null
    }
}

function sha256(content: string): string {
    return createHash('sha256').update(content).digest('hex')
}

function collectAll(ctx: RunContext): EnvVar[] {
    const out: EnvVar[] = []
    const firstSeenBy = new Map<string, { feature: string, value: string }>()

    // Stage order, so the first declarer of a key wins.
    const sorted = [...ctx.enabledFeatures]
        .map((id) => ctx.registries.features.get(id))
        .sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage))

    for (const feature of sorted) {
        const vars = feature.collectEnv?.(ctx) ?? []
        for (const v of vars ?? []) {
            // Only static string defaults are comparable; factories are non-deterministic.
            const value = typeof v.value === 'string' ? v.value : ''
            const prior = firstSeenBy.get(v.key)
            if (prior) {
                // Two different recommended defaults for one key.
                if (value && prior.value && value !== prior.value) {
                    throw new Error(
                        `Env-var collision: "${v.key}" declared by both `
                        + `${prior.feature} (= ${prior.value}) and ${feature.id} `
                        + `(= ${value}) with conflicting defaults. Pick one.`,
                    )
                }
                continue
            }
            firstSeenBy.set(v.key, { feature: feature.id, value })
            out.push(v)
        }
    }
    return out
}

/** Collect env keys for a single feature. */
export function collectEnvForFeature(ctx: RunContext, featureId: string): EnvVar[] {
    if (!ctx.registries.features.has(featureId)) return []
    const feature = ctx.registries.features.get(featureId)
    return feature.collectEnv?.(ctx) ?? []
}

function resolveValue(v: EnvVar): string {
    if (v.generate) return generateSecret(v.generate)
    if (typeof v.value === 'function') return v.value()
    if (typeof v.value === 'string') return v.value
    return ''
}

function generateSecret(spec: NonNullable<EnvVar['generate']>): string {
    return randomBytes(spec.bytes).toString(spec.encoding ?? 'hex')
}

// Values meaning "not configured yet".
const PLACEHOLDER_VALUES = new Set(['', 'change-me', 'changeme', 'replace-me', 'replaceme'])

/** True when `current` is an unconfigured placeholder (not a real user value). */
function isPlaceholder(v: EnvVar, current: string): boolean {
    const c = current.trim().toLowerCase()
    if (PLACEHOLDER_VALUES.has(c)) return true
    return v.example != null && c === v.example.trim().toLowerCase()
}

/** `openssl`-equivalent hint for a generatable secret, shown in `.env.example`. */
function generateHint(spec: NonNullable<EnvVar['generate']>): string {
    const flag = (spec.encoding ?? 'hex') === 'base64url' ? 'base64' : 'hex'
    return `Generate a strong random value, e.g. \`openssl rand -${flag} ${spec.bytes}\`. Leave as change-me and battlestack fills it on \`battlestack install\`.`
}

/** Rewrites only the values of `updates` keys, preserving every other line byte-for-byte. */
function rewriteEnvValues(raw: string, updates: Map<string, string>): string {
    if (updates.size === 0) return raw
    return raw
        .split('\n')
        .map((line) => {
            const trimmed = line.trimStart()
            if (!trimmed || trimmed.startsWith('#')) return line
            const eq = line.indexOf('=')
            if (eq < 0) return line
            const key = line.slice(0, eq).trim()
            const next = updates.get(key)
            return next === undefined ? line : `${key}=${quoteEnvValue(next)}`
        })
        .join('\n')
}

function renderEnv(vars: EnvVar[], existing: Map<string, string>): string {
    const resolved = vars.map((v) => ({
        ...v,
        resolved: existing.get(v.key) ?? resolveValue(v),
    }))
    return renderGrouped(resolved, (entry) => `${entry.key}=${quoteEnvValue(entry.resolved)}`)
}

const EXAMPLE_HEADER = [
    '# .env.example: committed reference for the keys this project needs.',
    '#',
    '# Copy to .env and fill in real values, or run `battlestack install` to generate one.',
    '# Keys left as `change-me` that are self-owned secrets (e.g. NUXT_SESSION_PASSWORD,',
    '# NUXT_TOTP_ENCRYPTION_KEY) are auto-generated by `battlestack install`; the comment above',
    '# each shows the equivalent `openssl rand` command if you prefer to set them yourself.',
    '# External credentials (SMTP, OAuth, API keys) must be filled in by hand.',
    '',
    '',
].join('\n')

function renderExample(vars: EnvVar[]): string {
    return EXAMPLE_HEADER + renderGrouped(
        vars,
        (v) => {
            // Generatable secrets advertise `change-me` in the example.
            const placeholder = v.generate
                ? 'change-me'
                : v.example ?? (typeof v.value === 'string' ? v.value : 'replace-me')
            return `${v.key}=${quoteEnvValue(placeholder)}`
        },
        (v) => (v.generate ? generateHint(v.generate) : undefined),
    )
}

// Section markers for preserved project-specific keys, filtered out of captured comments.
const EXAMPLE_CUSTOM_HEADER
    = '# Project-specific keys, preserved by battlestack across `battlestack install` (battlestack only manages the keys above).'
const ENV_CUSTOM_HEADER
    = '# Project-specific (from .env.example): fill these in.'
const SECTION_MARKERS = new Set([EXAMPLE_CUSTOM_HEADER, ENV_CUSTOM_HEADER])

interface CustomEntry { key: string, block: string }

/** Assignment lines and preceding comments for keys no feature declares, preserved verbatim. */
function extractCustomEntries(raw: string, battlestackKeys: Set<string>): CustomEntry[] {
    const out: CustomEntry[] = []
    let comment: string[] = []
    for (const line of raw.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.startsWith('#')) {
            if (!SECTION_MARKERS.has(trimmed)) comment.push(line)
            continue
        }
        if (trimmed === '') {
            comment = []
            continue
        }
        const eq = line.indexOf('=')
        if (eq > 0) {
            const key = line.slice(0, eq).trim()
            if (!battlestackKeys.has(key)) {
                out.push({ key, block: [...comment, line].join('\n') })
            }
        }
        comment = []
    }
    return out
}

/** battlestack-owned example block + a preserved section for any project-specific keys. */
function mergeExample(battlestackBlock: string, custom: CustomEntry[]): string {
    if (custom.length === 0) return battlestackBlock
    const sep = battlestackBlock.endsWith('\n') ? '' : '\n'
    return `${battlestackBlock}${sep}\n${EXAMPLE_CUSTOM_HEADER}\n`
        + custom.map((c) => c.block).join('\n') + '\n'
}

// Values with shell/compose-significant chars or whitespace are double-quoted, escaping `\` and `"`.
function quoteEnvValue(value: string): string {
    if (value === '' || /^[A-Za-z0-9_./:@%+,=-]+$/.test(value)) return value
    const escaped = value.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`)
    return `"${escaped}"`
}

function renderGrouped<T extends { key: string, group?: string, description?: string }>(
    vars: T[],
    line: (v: T) => string,
    hint?: (v: T) => string | undefined,
): string {
    const lines: string[] = []
    let currentGroup: string | undefined
    for (const v of vars) {
        const group = v.group ?? 'General'
        if (group !== currentGroup) {
            if (lines.length > 0) lines.push('')
            lines.push(`# ${group}`)
            currentGroup = group
        }
        if (v.description) lines.push(`# ${v.description}`)
        const h = hint?.(v)
        if (h) lines.push(`# ${h}`)
        lines.push(line(v))
    }
    return lines.join('\n') + '\n'
}

export function parseEnv(content: string): Map<string, string> {
    const out = new Map<string, string>()
    for (const raw of content.split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line.startsWith('#')) continue
        const eq = line.indexOf('=')
        if (eq < 0) continue
        const key = line.slice(0, eq).trim()
        const value = line.slice(eq + 1).trim()
        out.set(key, value)
    }
    return out
}
