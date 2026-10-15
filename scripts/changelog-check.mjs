#!/usr/bin/env node
/**
 * PR gate: a change to what ships (anything under `packages/`, except each package's own `test/` and README)
 * must add an entry under `## Unreleased` in CHANGELOG.md, which Prepare release turns into the release notes.
 *
 *   CHANGELOG_CHECK_BASE=origin/main node scripts/changelog-check.mjs
 *
 * Bypass with a truthy $SKIP_CHANGELOG_CHECK, which CI sets from the `skip-changelog` PR label.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** True for a path that reaches users: published package code, templates, or a package manifest. */
export function isShipped(file) {
    if (!file.startsWith('packages/')) return false
    return !/^packages\/[^/]+\/(test\/|README\.md$)/.test(file)
}

/** First line of every bullet in the `## Unreleased` section, or `[]` when there is none. */
export function unreleasedEntries(markdown) {
    const section = /^## Unreleased[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(markdown)
    if (!section) return []
    return section[1].split('\n').filter((line) => line.startsWith('- ')).map((line) => line.trim())
}

function git(args) {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function main() {
    if (/^(1|true|yes)$/i.test(process.env.SKIP_CHANGELOG_CHECK ?? '')) {
        console.log('changelog check bypassed via SKIP_CHANGELOG_CHECK')
        return
    }
    // Prepare release folds `## Unreleased` into the version stanza, so its PR removes entries by design.
    if ((process.env.CHANGELOG_CHECK_HEAD_REF ?? '').startsWith('release/v')) {
        console.log('changelog check skipped for a release branch')
        return
    }
    const base = process.env.CHANGELOG_CHECK_BASE?.trim()
    if (!base) {
        console.log('changelog check: no base ref (not a pull request), nothing to compare')
        return
    }

    const shipped = git(['diff', '--name-only', '--no-renames', `${base}...HEAD`]).split('\n').filter(isShipped)
    if (shipped.length === 0) {
        console.log('OK: nothing under packages/ ships from this change, no entry needed')
        return
    }

    let before = ''
    try {
        before = git(['show', `${base}:CHANGELOG.md`])
    } catch {
        // No CHANGELOG.md at the base: every entry on HEAD is new.
    }
    const known = new Set(unreleasedEntries(before))
    const added = unreleasedEntries(readFileSync('CHANGELOG.md', 'utf8')).filter((e) => !known.has(e))
    if (added.length > 0) {
        console.log(`OK: ${added.length} new Unreleased entr${added.length === 1 ? 'y' : 'ies'}`)
        return
    }

    console.log('FAIL: this change ships, but CHANGELOG.md gained no entry under `## Unreleased`.')
    console.log(`  shipped files: ${shipped.slice(0, 5).join(', ')}${shipped.length > 5 ? `, +${shipped.length - 5} more` : ''}`)
    console.log('  fix:   add a line under `## Unreleased` saying what changes for someone using battlestack')
    console.log('\nbypass (sparingly): SKIP_CHANGELOG_CHECK=1, or the `skip-changelog` label on the PR')
    process.exit(1)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
