#!/usr/bin/env node
/**
 * Token contract gate.
 *
 * "The names are the contract." A theme package may change token *values* as
 * much as it likes — that is the whole point of a theme — but it may not add a
 * name to the semantic surface or drop one, because every component in
 * `@sevenlab/ui` is written against that surface and there will eventually be
 * ten client themes behind it.
 *
 * The canonical set is derived from `@sevenlab/ui-default`'s own tokens: every
 * custom property declared on `:root` or `[data-theme="dark"]` in the files
 * reachable from `tokens/index.css`.
 *
 * What counts as "the contract":
 *   Everything in that set except the raw colour ramps (--gray-*, --blue-*,
 *   --mint-*, --lilac-*, --peach-*, --green-*, --amber-*, --red-*). Those are
 *   the primitive layer — the export's own header says components never
 *   reference them. The rest of `vendor/primitives.css` (--space-*, --radius-*,
 *   --icon-*, --dur-*, --ease-*, --z-*, --bp-*) is named semantically and
 *   PORTING.md tells component authors to use it directly, so it stays in.
 *
 * Additions are judged by what they are *for*, not by their name, because a
 * client's private ramp will not be called `--blue-*`:
 *   - an added name that some other token references is a primitive — it exists
 *     to define a contract token, which is exactly what primitives are for. It
 *     is reported, not failed.
 *   - an added name that nothing else in the token layer references can only be
 *     consumed by a component. That is a new contract token, and it fails.
 *
 * Usage:
 *   node scripts/check-contract.mjs                 # self-check: default vs itself
 *   node scripts/check-contract.mjs <tokens-dir>…   # check client themes
 *   node scripts/check-contract.mjs --emit          # also regenerate tokens.json/.d.ts
 *
 * Without --emit the script writes nothing; it instead fails if the committed
 * generated artifacts have drifted from the tokens they were generated from.
 *
 * The CSS walking below is deliberately a second copy of the one in
 * check-contrast.mjs. These are two standalone gates with no build step behind
 * them — `node scripts/<gate>.mjs` has to work on a bare checkout. If a third
 * gate needs the same parse, that is the point to extract a shared module.
 */

import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const TOKENS_DIR = resolvePath(HERE, '../tokens')
const JSON_OUT = join(TOKENS_DIR, 'tokens.json')
const DTS_OUT = join(TOKENS_DIR, 'tokens.d.ts')

/**
 * The primitive colour ramps, plus the raw elevation steps. Anything matching
 * this is below the contract:
 * a theme may add, drop or renumber a ramp step freely.
 */
const RAMP = /^--(?:(?:gray|blue|mint|lilac|peach|green|amber|red)-\d+|shadow-\d+)$/

/** Matches `[data-theme="dark"]`, `[data-theme=dark]` and the single-quoted form. */
const DARK_SELECTOR = /\[data-theme=["']?dark["']?\]/

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

/**
 * Reads one token package.
 *
 * `light` and `dark` hold only what each theme *declares*, kept apart because
 * the contract is about names, not resolved values. Later declarations win,
 * which is how the cascade resolves these files — they are all
 * same-specificity `:root` rules.
 */
function readTokens(dir) {
    const files = cssFilesIn(dir)
    const light = new Map()
    const dark = new Map()

    for (const file of files) {
        for (const { selector, declarations } of parseDeclarations(readFileSync(file, 'utf8'))) {
            const isDark = DARK_SELECTOR.test(selector)
            const isRoot = selector.split(',').some((s) => s.trim() === ':root')
            if (!isDark && !isRoot) continue

            for (const [name, value] of declarations) {
                if (isDark) dark.set(name, value)
                else light.set(name, value)
            }
        }
    }

    // Declaration order, light first: what tokens.json and the union type use.
    const names = [...light.keys(), ...[...dark.keys()].filter((n) => !light.has(n))]

    return { dir, files, light, dark, names }
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

/** Dark inherits every light declaration it does not override, as in the browser. */
function darkMap(theme) {
    return new Map([...theme.light, ...theme.dark])
}

/** True if any *other* token's value contains `var(--name)` — i.e. it is a primitive. */
function isReferencedByAnotherToken(theme, name) {
    const needle = new RegExp(`var\\(\\s*${name}\\b`)
    for (const map of [theme.light, theme.dark]) {
        for (const [other, value] of map) {
            if (other !== name && needle.test(value)) return true
        }
    }
    return false
}

const inContract = (name) => !RAMP.test(name)

// ── Generated artifacts ──────────────────────────────────────────────────────

const GENERATED_BY = 'scripts/check-contract.mjs'
const REGENERATE = 'pnpm --filter @sevenlab/ui-default check:contract --emit'

/**
 * JSON has no comments, so the marker is a `$generated` key instead — same job,
 * and a consumer reading the file with JSON.parse still sees it.
 */
function buildJson(theme) {
    const dark = darkMap(theme)
    const tokens = {}

    for (const name of theme.names) {
        if (!inContract(name)) continue

        const entry = {
            light: { raw: theme.light.get(name) ?? null, value: resolveToken(theme.light, name) },
            dark: { raw: theme.dark.get(name) ?? theme.light.get(name) ?? null, value: resolveToken(dark, name) },
        }
        // Flagged rather than omitted: "dark reuses the light value" is a
        // deliberate design decision (spacing, radii, most component knobs),
        // not missing data.
        if (!theme.dark.has(name)) entry.dark.inherited = true

        tokens[name] = entry
    }

    return `${JSON.stringify({
        $generated: `Generated by ${GENERATED_BY} — do not edit. Regenerate with \`${REGENERATE}\`.`,
        tokens,
    }, null, 4)}\n`
}

function buildDts(theme) {
    const names = theme.names.filter(inContract)

    return [
        `/* Generated by ${GENERATED_BY} — do not edit.`,
        `   Regenerate with \`${REGENERATE}\`.`,
        '',
        '   Every semantic token a component may reference. A client theme retunes the',
        '   values behind these names; the names themselves are the contract, and',
        '   check-contract.mjs fails the build if a theme adds one or drops one. */',
        '',
        '/** A Battlestack semantic token. Components reference only these. */',
        // The first member shares the `=` line so the emitted file passes the
        // repo's own ESLint (@stylistic/operator-linebreak wants no trailing `=`).
        `export type BsSemanticToken = '${names[0]}'`,
        ...names.slice(1).map((name) => `    | '${name}'`),
        '',
        '/** A `var()` reference to a semantic token, for typed inline custom properties. */',
        'export type BsTokenRef = `var(${BsSemanticToken})`',
        '',
    ].join('\n')
}

/** Reads a generated file, or null when it has never been emitted. */
function readIfPresent(file) {
    try {
        return readFileSync(file, 'utf8')
    } catch {
        return null
    }
}

// ── Checks ───────────────────────────────────────────────────────────────────

/**
 * A name declared only under [data-theme="dark"] exists in one theme and not
 * the other: any component using it renders unstyled in light. Light is where
 * a token is born; dark retunes it.
 */
function checkDarkOnly(theme, label) {
    const failures = []

    for (const name of theme.dark.keys()) {
        if (theme.light.has(name)) continue
        failures.push(`  fail  ${label}: ${name} is defined in dark but never in light`)
    }

    return failures
}

/** Compares a theme's declared names against the canonical set. */
function checkAgainstCanonical(canonical, theme, self) {
    const failures = []
    const notes = []

    const canonicalNames = new Set(canonical.names)
    const themeNames = new Set(theme.names)

    const missing = canonical.names.filter((n) => inContract(n) && !themeNames.has(n))
    const redefined = theme.names.filter((n) => inContract(n) && canonicalNames.has(n))
    const added = theme.names.filter((n) => !canonicalNames.has(n))

    const primitiveAdds = added.filter((n) => isReferencedByAnotherToken(theme, n))
    const contractAdds = added.filter((n) => !primitiveAdds.includes(n))

    if (self) {
        notes.push(`  note  ${redefined.length} contract tokens declared here — this is the contract`)
    } else {
        notes.push(`  note  ${missing.length} inherited from the default theme (not redefined here)`)
        notes.push(`  note  ${redefined.length} redefined — that is what a theme is for`)
    }

    if (primitiveAdds.length > 0) {
        notes.push(`  note  ${primitiveAdds.length} private ${primitiveAdds.length === 1 ? 'primitive' : 'primitives'} added, each consumed by another token:`)
        for (const name of primitiveAdds) notes.push(`          ${name}`)
    }

    for (const name of contractAdds) {
        failures.push(`  fail  ${name} is not in the default theme's contract\n            nothing else in the token layer references it, so only a component can`)
    }

    return { failures, notes }
}

// ── Runner ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const emit = args.includes('--emit')
const dirs = args.filter((a) => !a.startsWith('--'))

const canonical = readTokens(TOKENS_DIR)
const contractSize = canonical.names.filter(inContract).length

console.log(`\ncontract · canonical set from ${TOKENS_DIR}`)
console.log(`  ${canonical.files.length} files, ${canonical.names.length} tokens, ${contractSize} in the contract`)

let failed = 0

// The canonical package is checked first and on its own terms: a dark-only
// token here would be baked into every client theme downstream.
const canonicalFailures = checkDarkOnly(canonical, 'ui-default')
if (canonicalFailures.length > 0) {
    failed += canonicalFailures.length
    console.log(canonicalFailures.join('\n'))
} else {
    console.log('  pass  every dark token has a light counterpart')
}

const targets = dirs.length > 0 ? dirs.map((d) => resolvePath(d)) : [TOKENS_DIR]

for (const dir of targets) {
    const theme = dir === TOKENS_DIR ? canonical : readTokens(dir)
    const self = theme === canonical

    console.log(`\ncontract · ${dir}${self ? ' (self-check)' : ''}`)
    console.log(`  ${theme.files.length} files, ${theme.names.length} tokens`)

    const darkFailures = self ? [] : checkDarkOnly(theme, 'theme')
    const { failures, notes } = checkAgainstCanonical(canonical, theme, self)
    const all = [...darkFailures, ...failures]

    for (const note of notes) console.log(note)

    if (all.length > 0) {
        failed += all.length
        console.log(all.join('\n'))
    } else {
        console.log('  pass  no token added, no contract name invented')
    }
}

// Generated artifacts. --emit writes them; a plain run only checks that what is
// committed still matches the tokens, so the check stays read-only.
const json = buildJson(canonical)
const dts = buildDts(canonical)

if (emit) {
    writeFileSync(JSON_OUT, json)
    writeFileSync(DTS_OUT, dts)
    console.log(`\nemit  ${JSON_OUT}\nemit  ${DTS_OUT}`)
} else {
    for (const [file, expected] of [[JSON_OUT, json], [DTS_OUT, dts]]) {
        const actual = readIfPresent(file)
        if (actual === expected) continue

        failed += 1
        console.log(`\n  fail  ${file} is ${actual === null ? 'missing' : 'stale'}`)
        console.log(`            regenerate with \`${REGENERATE}\``)
    }
}

if (failed > 0) {
    console.error(`\n${failed} token contract ${failed === 1 ? 'violation' : 'violations'}.`)
    process.exit(1)
}

console.log('\nToken contract holds.')
