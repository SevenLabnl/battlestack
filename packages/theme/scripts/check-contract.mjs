#!/usr/bin/env node
/**
 * Token-contract gate for the theme.
 *
 * The contract: a theme (this one, a client copy, a project's brand.css)
 * re-values token *names* that Nuxt UI and Tailwind already know — it never
 * invents one, because an invented name resolves to nothing anywhere.
 *
 * Three mechanical rules over `tokens.css`:
 *
 *   1. `@theme` may only declare names Tailwind understands here: full
 *      50–950 color ramps and the two font stacks. A partial ramp is an error
 *      (Nuxt UI requires every shade of an aliased palette).
 *   2. `:root`/`.dark` may only set documented `--ui-*` names.
 *   3. Every `--ui-*` set on `:root` must be restated in `.dark` — these
 *      declarations load after Nuxt UI's own `.dark` block, so an unrestated
 *      light value silently wins in dark mode too.
 *
 * Any violation exits 1.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const css = readFileSync(path.join(root, '..', 'tokens.css'), 'utf8')

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]

/** `--ui-*` names a theme may value. From https://ui.nuxt.com/docs/getting-started/theme/css-variables */
const UI_NAMES = new Set([
    '--ui-bg', '--ui-bg-muted', '--ui-bg-elevated', '--ui-bg-accented', '--ui-bg-inverted',
    '--ui-text-dimmed', '--ui-text-muted', '--ui-text-toned', '--ui-text', '--ui-text-highlighted', '--ui-text-inverted',
    '--ui-border', '--ui-border-muted', '--ui-border-accented', '--ui-border-inverted',
    '--ui-primary', '--ui-secondary', '--ui-success', '--ui-info', '--ui-warning', '--ui-error',
    '--ui-radius', '--ui-container', '--ui-header-height',
])

function names(selector) {
    const start = css.indexOf(`${selector} {`)
    if (start === -1) throw new Error(`tokens.css: no "${selector}" block`)
    const body = css.slice(start, css.indexOf('}', start))
    return [...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])
}

const errors = []

// Rule 1 — @theme shape.
const themeNames = names('@theme static')
const ramps = new Map()
for (const n of themeNames) {
    const ramp = n.match(/^--color-([a-z]+)-(\d+)$/)
    if (ramp) {
        ramps.set(ramp[1], (ramps.get(ramp[1]) ?? new Set()).add(Number(ramp[2])))
    } else if (n !== '--font-sans' && n !== '--font-mono') {
        errors.push(`@theme declares ${n}: only full color ramps and --font-sans/--font-mono belong here`)
    }
}
for (const [ramp, shades] of ramps) {
    const missing = SHADES.filter((s) => !shades.has(s))
    if (missing.length > 0) errors.push(`ramp --color-${ramp}-* misses shades ${missing.join(', ')} (Nuxt UI needs all of 50–950)`)
}

// Rule 2 — only documented --ui-* names on :root/.dark.
const lightNames = names(':root')
const darkNames = names('.dark')
for (const n of [...lightNames, ...darkNames]) {
    if (!UI_NAMES.has(n)) errors.push(`unknown token ${n}: not a documented Nuxt UI --ui-* variable`)
}

// Rule 3 — dark restatement for every :root override (radius has no mode).
const MODE_NEUTRAL = new Set(['--ui-radius', '--ui-container', '--ui-header-height'])
for (const n of lightNames) {
    if (!MODE_NEUTRAL.has(n) && !darkNames.includes(n)) {
        errors.push(`${n} is set on :root but not restated in .dark — its light value will win in dark mode`)
    }
}

if (errors.length > 0) {
    console.error(`check:contract failed (${errors.length}):\n- ${errors.join('\n- ')}`)
    process.exit(1)
}
console.log(`check:contract passed — ${ramps.size} ramps, ${lightNames.length} light + ${darkNames.length} dark --ui-* values`)
