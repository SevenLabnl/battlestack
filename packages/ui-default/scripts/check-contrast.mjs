#!/usr/bin/env node
/**
 * Contrast gate.
 *
 * The design system calls colour changes "the only place theming can break".
 * This walks the actual token files, resolves every var() chain the way a
 * browser would, and checks the WCAG 2.2 AA pairs in **both** themes. It runs
 * on the default theme and on every client theme, so a client that nudges the
 * accent and drops below 4.5:1 finds out in the pull request.
 *
 * Usage: node scripts/check-contrast.mjs [<tokens-dir> ...]
 * Exits non-zero on the first failing pair.
 */

import { readFileSync, statSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))

/** WCAG minimums. Non-text (borders, focus rings) is 3:1; everything else 4.5:1. */
const TEXT = 4.5
const NON_TEXT = 3

/**
 * The contract. Each entry is [foreground, background, minimum, label].
 * Backgrounds must resolve to an opaque colour; translucent foregrounds are
 * composited over the background first, the way the browser paints them.
 */
const PAIRS = [
    ['--primary-fg', '--primary', TEXT, 'primary button label'],
    ['--danger-fg', '--danger-solid', TEXT, 'danger button label'],
    ['--fg', '--bg', TEXT, 'body text on canvas'],
    ['--fg', '--surface', TEXT, 'body text on card'],
    ['--fg-muted', '--bg', TEXT, 'muted text on canvas'],
    ['--fg-muted', '--surface', TEXT, 'muted text on card'],
    ['--link', '--bg', TEXT, 'link on canvas'],
    ['--link', '--surface', TEXT, 'link on card'],
    ['--success', '--success-bg', TEXT, 'success text on its tint'],
    ['--warning', '--warning-bg', TEXT, 'warning text on its tint'],
    ['--danger', '--danger-bg', TEXT, 'danger text on its tint'],
    ['--info', '--info-bg', TEXT, 'info text on its tint'],
    ['--primary-tint-fg', '--primary-tint', TEXT, 'accent text on its tint'],
    ['--tooltip-fg', '--tooltip-bg', TEXT, 'tooltip label'],
    ['--nav-fg', '--nav-bg', TEXT, 'sidebar label'],
    ['--nav-fg-muted', '--nav-bg', TEXT, 'sidebar muted label'],
    ['--border-strong', '--surface', NON_TEXT, 'control border on card'],
    ['--border-strong', '--bg', NON_TEXT, 'control border on canvas'],
    ['--focus', '--surface', NON_TEXT, 'focus ring on card'],
    ['--focus', '--bg', NON_TEXT, 'focus ring on canvas'],
]

// ── CSS parsing ──────────────────────────────────────────────────────────────

/** Strips comments, then collects `selector { --a: b; … }` declarations. */
function parseDeclarations(css) {
    // Statement at-rules (@import, @charset) are dropped before the blocks are
    // matched. They are not part of any selector, but they sit immediately
    // before one, and the selector regex would otherwise swallow them and stop
    // recognising the `:root` that follows.
    const clean = css
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/@[\w-]+[^;{}]*;/g, '')
    const blocks = []

    // Non-greedy body match is safe here: token files contain no nested braces.
    for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = match[1].trim()
        const declarations = new Map()

        for (const decl of match[2].split(';')) {
            const at = decl.indexOf(':')
            if (at === -1) continue
            const name = decl.slice(0, at).trim()
            if (!name.startsWith('--')) continue
            declarations.set(name, decl.slice(at + 1).trim())
        }

        if (declarations.size > 0) blocks.push({ selector, declarations })
    }

    return blocks
}

/**
 * Builds one token map per theme. Later declarations win, which is how the
 * cascade resolves these files — they are all same-specificity :root rules.
 */
function buildThemes(files) {
    const light = new Map()
    const dark = new Map()

    for (const file of files) {
        for (const { selector, declarations } of parseDeclarations(readFileSync(file, 'utf8'))) {
            const isDark = selector.includes('[data-theme="dark"]')
            const isRoot = selector.split(',').some((s) => s.trim() === ':root')
            if (!isDark && !isRoot) continue

            for (const [name, value] of declarations) {
                if (!isDark) light.set(name, value)
                dark.set(name, value)
            }
        }
    }

    return { light, dark }
}

/** Resolves var() chains, including fallbacks, with a cycle guard. */
function resolveToken(tokens, name, seen = new Set()) {
    if (seen.has(name)) throw new Error(`Circular token reference at ${name}`)
    seen.add(name)

    const raw = tokens.get(name)
    if (raw === undefined) return null

    const value = raw.trim()
    const varMatch = value.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/)
    if (!varMatch) return value

    const referenced = resolveToken(tokens, varMatch[1], seen)
    return referenced ?? (varMatch[2]?.trim() ?? null)
}

// ── Colour maths ─────────────────────────────────────────────────────────────

/** Parses hex (3/4/6/8 digit) and rgb()/rgba() into [r, g, b, a]. */
function parseColor(value) {
    if (!value) return null
    const input = value.trim().toLowerCase()

    const hex = input.match(/^#([0-9a-f]{3,8})$/)
    if (hex) {
        const digits = hex[1]
        const expand = (s) => s.split('').map((c) => c + c).join('')
        const full = digits.length <= 4 ? expand(digits) : digits
        if (full.length !== 6 && full.length !== 8) return null
        const byte = (i) => parseInt(full.slice(i * 2, i * 2 + 2), 16)
        return [byte(0), byte(1), byte(2), full.length === 8 ? byte(3) / 255 : 1]
    }

    const fn = input.match(/^rgba?\(([^)]+)\)$/)
    if (fn) {
        const parts = fn[1].split(/[,\s/]+/).filter(Boolean).map(Number)
        if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null
        return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1]
    }

    return null
}

/** Paints a translucent colour over an opaque one, as the browser would. */
function composite([r, g, b, a], [br, bg, bb]) {
    if (a >= 1) return [r, g, b]
    return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)]
}

function relativeLuminance([r, g, b]) {
    const channel = (v) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(fg, bg) {
    const a = relativeLuminance(fg)
    const b = relativeLuminance(bg)
    const [hi, lo] = a > b ? [a, b] : [b, a]
    return (hi + 0.05) / (lo + 0.05)
}

// ── Runner ───────────────────────────────────────────────────────────────────

/**
 * Walks the @import graph from an entry file, depth-first, in source order.
 *
 * Globbing a directory and sorting by name is wrong: it decides the cascade by
 * filename, so `vendor/semantic.css` would land after `pending-design.css` and
 * silently undo it. Following the imports is what the browser does, and it also
 * means files nobody imports (the vendored diff baselines) are correctly ignored.
 */
function importGraph(entry, seen = new Set()) {
    const file = resolvePath(entry)
    if (seen.has(file)) return []
    seen.add(file)

    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const dir = join(file, '..')
    const out = []

    // Imports must be collected before the file's own declarations: an @import
    // sits above the rules that follow it, so its values are the ones overridden.
    for (const match of css.matchAll(/@import\s+["']([^"']+)["']/g)) {
        out.push(...importGraph(join(dir, match[1]), seen))
    }

    out.push(file)
    return out
}

function cssFilesIn(target) {
    const full = resolvePath(target)
    if (!statSync(full).isDirectory()) return importGraph(full)

    const entry = join(full, 'index.css')
    if (!statSync(entry).isFile()) {
        throw new Error(`${full} has no index.css to walk imports from`)
    }
    return importGraph(entry)
}

function checkTheme(name, tokens) {
    const failures = []
    const skipped = []

    for (const [fgName, bgName, minimum, label] of PAIRS) {
        const fgRaw = resolveToken(tokens, fgName)
        const bgRaw = resolveToken(tokens, bgName)

        if (fgRaw === null || bgRaw === null) {
            skipped.push(`${label}: ${fgRaw === null ? fgName : bgName} is not defined`)
            continue
        }

        const fg = parseColor(fgRaw)
        const bg = parseColor(bgRaw)

        if (!fg || !bg) {
            skipped.push(`${label}: cannot parse ${!fg ? `${fgName} (${fgRaw})` : `${bgName} (${bgRaw})`}`)
            continue
        }

        if (bg[3] < 1) {
            skipped.push(`${label}: background ${bgName} is translucent, no opaque ground to composite over`)
            continue
        }

        const ratio = contrastRatio(composite(fg, bg), bg.slice(0, 3))
        const rounded = Math.round(ratio * 100) / 100

        if (ratio < minimum) {
            failures.push(`  ${name.padEnd(5)} ${label}\n        ${fgName} on ${bgName} — ${rounded}:1, needs ${minimum}:1`)
        }
    }

    return { failures, skipped }
}

const dirs = process.argv.slice(2)
const targets = dirs.length > 0 ? dirs.map((d) => resolvePath(d)) : [resolvePath(HERE, '../tokens')]

let failed = 0

for (const dir of targets) {
    const files = cssFilesIn(dir)
    const { light, dark } = buildThemes(files)

    console.log(`\ncontrast · ${dir}`)
    console.log(`  ${files.length} files, ${light.size} tokens`)

    for (const [themeName, tokens] of [['light', light], ['dark', dark]]) {
        const { failures, skipped } = checkTheme(themeName, tokens)

        for (const note of skipped) console.log(`  skip  ${note}`)

        if (failures.length > 0) {
            failed += failures.length
            console.log(failures.join('\n'))
        } else {
            console.log(`  pass  ${themeName}: ${PAIRS.length - skipped.length} pairs`)
        }
    }
}

if (failed > 0) {
    console.error(`\n${failed} contrast ${failed === 1 ? 'pair fails' : 'pairs fail'} WCAG 2.2 AA.`)
    process.exit(1)
}

console.log('\nAll contrast pairs pass WCAG 2.2 AA.')
