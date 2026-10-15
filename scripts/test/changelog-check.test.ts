import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs release tooling, no declaration file
import { isShipped, unreleasedEntries } from '../changelog-check.mjs'

describe('isShipped', () => {
    it.each([
        ['packages/core/src/utils/templates.ts', true],
        ['packages/preset-nuxt4/templates/auth/test/e2e/api/auth.test.ts', true],
        ['packages/preset-nuxt4/templates/ai-tool-config/claude-code/.claude/rules/vue.md', true],
        ['packages/theme/package.json', true],
        ['packages/cli/test/pull.test.ts', false],
        ['packages/cli/README.md', false],
        ['scripts/bump-check.ts', false],
        ['.github/workflows/ci.yml', false],
        ['CHANGELOG.md', false],
        ['pnpm-lock.yaml', false],
    ])('%s -> %s', (file, expected) => {
        expect(isShipped(file)).toBe(expected)
    })
})

describe('unreleasedEntries', () => {
    it('lists the first line of each Unreleased bullet', () => {
        const md = '# Changelog\n\n## Unreleased\n\n- One,\n  continued.\n- Two.\n\n## v1.3.0 (2026-09-24)\n\n- old\n'
        expect(unreleasedEntries(md)).toEqual(['- One,', '- Two.'])
    })

    it('is empty without an Unreleased section', () => {
        expect(unreleasedEntries('# Changelog\n\n## v1.3.0 (2026-09-24)\n\n- old\n')).toEqual([])
    })

    it('reads an Unreleased section that ends the file', () => {
        expect(unreleasedEntries('# Changelog\n\n## Unreleased\n\n- Only.\n')).toEqual(['- Only.'])
    })
})
