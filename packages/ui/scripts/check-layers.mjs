#!/usr/bin/env node
/**
 * Layer gate.
 *
 * The token model is `primitive -> semantic -> component`. Primitives exist to
 * define semantic tokens and nothing else; a component that reaches past the
 * semantic layer is a component a client theme cannot retheme, which is the one
 * failure mode the whole package split exists to prevent. Same for a raw hex or
 * a raw px where a token already says the same thing.
 *
 * Scope — deliberately two explicit lists rather than one wide glob:
 *   components/**\/*.vue     every component, at any depth
 *   styles/extra/*.css       the additive per-group stylesheets
 *
 * Everything else is out of scope on purpose:
 *   - `styles/vendor/**` is the design system's own CSS, vendored byte-identical
 *     so the next export stays a diff. It defines the semantic layer's usage; it
 *     is not ours to lint.
 *   - `@sevenlab/ui-default`'s `styles/bridge.css` legitimately uses primitives —
 *     it maps another design system's colour ramp onto ours, which is a theme
 *     package's job. It lives in a different package and the scan is rooted at
 *     this package, so no glob here can reach it.
 *
 * ── The three rules ─────────────────────────────────────────────────────────
 *
 * 1. No primitive token. `--gray-*`, `--blue-*`, `--mint-*`, `--lilac-*`,
 *    `--peach-*`, `--green-*`, `--amber-*`, `--red-*`, `--shadow-<n>`.
 *
 *    `--shadow-1/2/3` are labelled "Elevation (raw)" in primitives.css and have
 *    semantic aliases (`--shadow-card`, `--shadow-raised`, `--shadow-overlay`), so
 *    they are the elevation ramp exactly as `--gray-*` is the neutral one — a
 *    component naming one is a component a client theme cannot re-elevate. Only the
 *    numbered ones are forbidden; the aliases are the semantic layer.
 *
 * 2. No raw hex colour. References that merely start with `#` — `url(#gradient)`,
 *    `href="#main"` — are not colours and are skipped.
 *
 * 3. No raw px **where a token exists**. The qualifier is the rule, so the gate
 *    implements it literally: a literal px value fails when the token scale for
 *    that property's role holds that exact value.
 *
 *      role      scale                              tokens
 *      spacing   4 8 12 16 20 24 32 40 48 64 80     --space-1…20 (4px grid)
 *      control   32 38 44                           --control-h-sm/md/lg
 *      radius    8 10 16 24 999                     --radius-*, --control-radius
 *      type      12 13 14 16 18 20 24 30            --text-xs…4xl
 *      focus     2                                  --focus-w, --focus-offset
 *
 *    The role comes from the property the value belongs to: `font-size: 14px`
 *    fails (`--text-md`), `width: 14px` does not — 14 is a type step, not a
 *    length one. A value with no property in front of it (a bare `'32px'`
 *    fallback in a `<script>`, a custom property being set) is read against the
 *    spacing scale, which is where a hand-written dimension almost always
 *    belongs.
 *
 *    Why this and not "no px at all": the design system itself specifies values
 *    the scales do not name — a 3px bar cap, a 10.5px chart tick, a 1080px
 *    container. There is no token to point those at, so failing them would only
 *    teach people to route around the gate. What it does catch is every value
 *    that has a name: `padding: 16px` for `--space-4`, `height: 38px` for
 *    `--control-h-md`, `border-radius: 10px` for `--control-radius`,
 *    `outline-width: 2px` for `--focus-w`.
 *
 *    Two consequences worth stating outright, both intended:
 *      - `1px` hairlines and `0` always pass. No token holds either value; the
 *        export writes every hairline as a literal `1px`.
 *      - the per-instance custom properties PORTING.md allows (a spinner's
 *        `--sp`, a grid's column count) need no exception. They are computed
 *        (`` `${size}px` ``, `cols * 24 + 'px'`), so no literal number ever sits
 *        against `px`. A *literal* `'--sp': '16px'` does fail, and should — a
 *        hardcoded default belongs in a prop default, not in the markup.
 *
 *    `@media` / `@container` conditions are skipped outright. Media queries
 *    cannot read custom properties — `vendor/primitives.css` says as much where
 *    it defines `--bp-*` as "reference values".
 *
 * Usage: node scripts/check-layers.mjs
 * Exits non-zero with every violation listed, file:line and the offending text.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const PACKAGE = resolvePath(HERE, '..')

/**
 * The primitive ramps: the eight colour ones, plus the numbered elevation steps.
 * Nothing in a component may name one. `--shadow-` is matched only where a digit
 * follows, so `--shadow-card` / `--shadow-raised` / `--shadow-overlay` stay legal.
 */
const PRIMITIVE = /--(?:(?:gray|blue|mint|lilac|peach|green|amber|red)-[\w-]+|shadow-[0-9][\w-]*)/g

/** 3, 4, 6 or 8 hex digits. Longer runs are ids, not colours. */
const HEX = /#([0-9a-fA-F]+)\b/g
const HEX_LENGTHS = new Set([3, 4, 6, 8])

/** A literal number immediately followed by `px`. */
const PX = /(?<![\w.#])(-?\d*\.?\d+)px\b/g

/**
 * What may sit directly before a colour: whitespace, or one of the delimiters a
 * value starts after. A `#` glued to a word is a fragment or an id — the tail of
 * `https://example.com/page#abcdef` is not a colour anyone can theme.
 */
const COLOR_OPENS = /(?:^|[\s(,:;'"=[])$/

/** `url(#…)` and `href="#…"` are references, not colours. */
const NOT_A_COLOR = /(?:url\(\s*|(?:xlink:)?href\s*=\s*["']?)$/

/**
 * The values the token scales actually name, per role. Taken from the default
 * theme's scales, which is the right reference even for a client that retunes
 * them: what makes a literal wrong is that the system has a *name* for it.
 * Component knobs (--field-gap, --table-row-h, --sidebar-w, --dialog-w-*) are
 * deliberately absent — they are per-feature values, not a scale to draw from,
 * and matching against them would point a chart's 6px gap at a form token.
 */
const SCALES = {
    spacing: { values: [4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80], hint: '--space-*' },
    control: { values: [32, 38, 44], hint: '--control-h-sm/md/lg' },
    radius: { values: [8, 10, 16, 24, 999], hint: '--radius-*, --control-radius, --card-radius' },
    type: { values: [12, 13, 14, 16, 18, 20, 24, 30], hint: '--text-xs…4xl' },
    focus: { values: [2], hint: '--focus-w, --focus-offset' },
}

/**
 * Which scales a property may draw from. First match wins; anything unmatched —
 * including a custom property and a bare literal with no property at all — is
 * read as a length.
 */
const ROLES = [
    [/^font-size$/, ['type']],
    [/^border-radius/, ['radius']],
    [/^outline(-width|-offset)?$/, ['focus']],
    [/^(min-|max-)?(height|block-size)$/, ['spacing', 'control']],
]

const DEFAULT_ROLES = ['spacing']

/**
 * The property a value belongs to: the last `name:` before it, cut at the
 * nearest declaration boundary. Covers a CSS declaration, a JS style object
 * (`{ padding: '16px' }`, `{ 'font-size': '14px' }`) and an inline style
 * attribute in one pass, because all three write `name: value`.
 */
function propertyBefore(text) {
    const boundary = Math.max(text.lastIndexOf(';'), text.lastIndexOf('{'), text.lastIndexOf(','))
    const segment = text.slice(boundary + 1)
    const match = segment.match(/["']?(--)?([-a-zA-Z]+)["']?\s*:/)
    if (!match) return null
    return match[1] ? `--${match[2]}` : match[2]
}

/** The token that already names this value for this property, or null. */
function tokenFor(property, value) {
    const roles = ROLES.find(([pattern]) => property && pattern.test(property))?.[1] ?? DEFAULT_ROLES

    for (const role of roles) {
        if (SCALES[role].values.includes(value)) return SCALES[role].hint
    }
    return null
}

// ── Reading ──────────────────────────────────────────────────────────────────

/**
 * Blanks out comments while keeping every newline, so reported line numbers
 * still line up with the file on disk.
 *
 * Not optional: the header of every `styles/extra/*.css` spells the rule out
 * with `--gray-200, --blue-500` as the example, and a gate that fails on its
 * own instructions is a gate people switch off.
 */
function stripComments(text, isVue) {
    const blank = (match) => match.replace(/[^\n]/g, ' ')

    let out = text.replace(/\/\*[\s\S]*?\*\//g, blank)
    if (isVue) {
        out = out.replace(/<!--[\s\S]*?-->/g, blank)
        // `(?<![:\w])` keeps the `//` of a URL out of it. Worst case a real
        // violation later on a URL line is missed; it never invents one.
        out = out.replace(/(?<![:\w])\/\/[^\n]*/g, blank)
    }
    return out
}

/** Files in one scope. `recursive` is false for styles/extra: it has no subdirectories. */
function filesIn(root, extension, recursive) {
    const dir = join(PACKAGE, root)

    try {
        if (!statSync(dir).isDirectory()) return []
    } catch {
        return []
    }

    return readdirSync(dir, { recursive, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
        .map((entry) => join(entry.parentPath ?? dir, entry.name))
        .sort()
}

const SCOPES = [
    { root: 'components', extension: '.vue', recursive: true },
    { root: 'styles/extra', extension: '.css', recursive: false },
]

// ── Rules ────────────────────────────────────────────────────────────────────

function checkLine(line) {
    const found = []

    for (const match of line.matchAll(PRIMITIVE)) {
        found.push({ rule: 'primitive', text: match[0], column: match.index + 1 })
    }

    for (const match of line.matchAll(HEX)) {
        if (!HEX_LENGTHS.has(match[1].length)) continue
        const before = line.slice(0, match.index)
        if (!COLOR_OPENS.test(before) || NOT_A_COLOR.test(before)) continue
        found.push({ rule: 'hex', text: match[0], column: match.index + 1 })
    }

    // Only the condition itself is exempt, not the rest of the line: a
    // single-line `@media (min-width: 640px) { .x { padding: 24px } }` still has
    // its declarations checked.
    const query = line.match(/@(?:media|container)\b/)
    const brace = query ? line.indexOf('{', query.index) : -1
    const queryEnd = query ? (brace === -1 ? line.length : brace) : -1

    for (const match of line.matchAll(PX)) {
        if (query && match.index > query.index && match.index < queryEnd) continue

        const property = propertyBefore(line.slice(0, match.index))
        const hint = tokenFor(property, Math.abs(Number(match[1])))
        if (!hint) continue
        found.push({ rule: 'px', text: match[0], column: match.index + 1, hint })
    }

    // Source order, so a line with two problems reads left to right.
    return found.sort((a, b) => a.column - b.column)
}

const REASON = {
    primitive: 'primitive token — components may only reference the semantic layer',
    hex: 'raw hex colour — use the semantic token for this colour',
    px: 'raw px — the scale already names this value',
}

/**
 * Additive CSS that touches a class the design system already owns.
 *
 * `styles/extra/*.css` sits after `styles/vendor/*.css` in the same cascade layer, so
 * a rule naming a vendored class changes every component already using it.
 *
 * Usually that is the point — scoping a vendored class under one of ours, or adding a
 * property to the same element. What it must never be is a *hijack*: reusing the name
 * for a different element. `.bs-page` is the vendored class for a pagination button; a
 * PageLayout rule took the same name and gave every page button `min-height: 100vh`.
 * Nothing caught it — it breaks no token rule, and each component's tests assert its
 * own classes, never the collision between two of them.
 *
 * Structure cannot tell the two apart: the hijack looked exactly like the legitimate
 * cases. So this gate does not judge — it fails on any collision that is not in the
 * acknowledged list below, which forces the question to be asked once, by a human, at
 * the moment the rule is written. Adding a name here means someone checked that it
 * augments the element the design system meant, and the reason is in the CSS file.
 */
const ACKNOWLEDGED = new Set([
    // Reka renders its own positioned wrapper; these return our panel to normal flow.
    'bs-menu', 'bs-popover', 'bs-tooltip__bubble', 'bs-listbox',
    // Reka marks the roving-focus item `data-highlighted`; vendor styles `[data-active]`.
    'bs-menu__item', 'bs-listbox__opt',
    // Elements that became lists in the port and need the list reset.
    'bs-breadcrumbs', 'bs-topnav__nav', 'bs-sidenav__item',
    // Same element, one property added — see the comment at each rule.
    'bs-table__num', 'bs-skel', 'bs-pagehead__meta', 'bs-sidenav__brand',
    'bs-check--disabled', 'bs-inputwrap',
    // Scoped under one of our own classes, not a redefinition of the bare class.
    'bs-chatmsg__content', 'bs-chatcomposer', 'bs-textarea',
    // Undoes the checkbox :indeterminate treatment that the spec also applies to an
    // unselected radio group — see the comment in extra/forms.css.
    'bs-radio',
    // Calms the focus treatment from three concentric bands to one accent edge —
    // see the comment in extra/forms.css.
    'bs-input',
])
function classNamesIn(files) {
    const names = new Map()

    for (const file of files) {
        const source = stripComments(readFileSync(file, 'utf8'), false)

        // Selector lists only: everything before a `{` that is not inside a block.
        for (const match of source.matchAll(/(^|})([^{}]+)\{/g)) {
            const selector = match[2]
            if (selector.trim().startsWith('@')) continue

            for (const cls of selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
                if (!names.has(cls[1])) names.set(cls[1], file)
            }
        }
    }

    return names
}

function classCollisions() {
    const vendor = classNamesIn(filesIn('styles/vendor', '.css', false))
    const extra = classNamesIn(filesIn('styles/extra', '.css', false))
    const clashes = []

    for (const [name, file] of extra) {
        if (vendor.has(name) && !ACKNOWLEDGED.has(name)) {
            clashes.push({ name, file, vendorFile: vendor.get(name) })
        }
    }

    return clashes
}

// ── Runner ───────────────────────────────────────────────────────────────────

const files = SCOPES.flatMap(({ root, extension, recursive }) => filesIn(root, extension, recursive))
const violations = []

for (const file of files) {
    const isVue = file.endsWith('.vue')
    const source = stripComments(readFileSync(file, 'utf8'), isVue)

    source.split('\n').forEach((line, index) => {
        for (const hit of checkLine(line)) {
            violations.push({ file, line: index + 1, ...hit })
        }
    })
}

const clashes = classCollisions()

console.log(`\nlayers · ${PACKAGE}`)
console.log(`  ${files.length} files scanned (components/**/*.vue, styles/extra/*.css)`)

if (clashes.length > 0) {
    const plural = clashes.length === 1 ? 'rule redefines' : 'rules redefine'
    console.log(`\n  ${clashes.length} additive ${plural} a vendored class:`)
    for (const clash of clashes) {
        console.log(`    .${clash.name}`)
        console.log(`          ${relative(PACKAGE, clash.file)} redefines ${relative(PACKAGE, clash.vendorFile)}`)
    }
    console.log('\n  If this augments the element the design system meant, add the name to')
    console.log('  ACKNOWLEDGED in this script with a reason. If it is a different element,')
    console.log('  pick a name the design system does not already own.')
}

if (violations.length === 0 && clashes.length === 0) {
    console.log('  pass  no primitive, no raw hex, no raw px')
    console.log(`  pass  no unacknowledged vendored-class collision (${ACKNOWLEDGED.size} acknowledged)`)
    console.log('\nComponents reference the semantic layer only.')
    process.exit(0)
}

let current = null
for (const violation of violations) {
    if (violation.file !== current) {
        current = violation.file
        console.log(`\n  ${relative(PACKAGE, violation.file)}`)
    }
    console.log(`    ${String(violation.line).padStart(4)}:${String(violation.column).padEnd(3)} ${violation.text}`)
    console.log(`          ${REASON[violation.rule]}${violation.hint ? ` (${violation.hint})` : ''}`)
}

const counts = new Map()
for (const violation of violations) counts.set(violation.rule, (counts.get(violation.rule) ?? 0) + 1)
const summary = [...counts].map(([rule, count]) => `${count} ${rule}`).join(', ')
    || `${clashes.length} unacknowledged vendored-class collision${clashes.length === 1 ? '' : 's'}`

console.error(`\n${violations.length} layer ${violations.length === 1 ? 'violation' : 'violations'} (${summary}).`)
process.exit(1)
