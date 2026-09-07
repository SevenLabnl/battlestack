import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PackageManager } from '@battlestack/core'
import { githubFeature } from '../src/features/github.js'
import { mockRunContext } from './test-utils.js'

/**
 * The emitted CI workflow shipped pnpm-hardcoded, so two of three advertised package
 * managers had a first push that could not go green. Hence the sweeping check below.
 */
let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-wf-test-'))
})

afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
})

async function render(pm: PackageManager): Promise<string> {
    await githubFeature.execute(
        mockRunContext({
            projectDir,
            enabledFeatures: new Set(['shared:github']),
            state: { packageManager: pm },
        }),
    )
    return readFile(
        path.join(projectDir, '.github/workflows/lint-test.yml'),
        'utf8',
    )
}

/**
 * Executable content only. Both comment syntaxes in this file (`#` for YAML, `//` in the
 * inline `node -e` script) legitimately name package managers in prose.
 */
const withoutComments = (yml: string): string =>
    yml
        .split('\n')
        .filter((l) => {
            const t = l.trimStart()
            return !t.startsWith('#') && !t.startsWith('//')
        })
        .join('\n')

const PMS: PackageManager[] = ['pnpm', 'npm', 'bun']

describe('emitted CI workflow: package-manager rendering', () => {
    it.each(PMS)('leaves no unsubstituted placeholder under %s', async (pm) => {
        // A surviving `__PM_*__` is not cosmetic: GitHub runs it verbatim as a command.
        expect(await render(pm)).not.toMatch(/__[A-Z0-9_]+__/)
    })

    it.each(['npm', 'bun'] as PackageManager[])(
        'no literal `pnpm` survives anywhere in a %s rendering',
        async (pm) => {
            expect(withoutComments(await render(pm))).not.toMatch(/pnpm/)
        },
    )

    it('renders pnpm as the reference shape', async () => {
        const yml = await render('pnpm')
        expect(yml).toContain('uses: pnpm/action-setup@v6')
        expect(yml).toContain('cache: pnpm')
        expect(yml).toContain('run: pnpm install --frozen-lockfile')
        expect(yml).toContain('pnpm exec nuxi prepare')
        expect(yml).toContain('pnpm run lint')
        expect(yml).toContain('pnpm run typecheck')
        expect(yml).toContain('pnpm run test:coverage')
        expect(yml).toContain('pnpm audit')
    })

    it('renders npm with no setup action and npm ci', async () => {
        const yml = await render('npm')
        // `actions/setup-node` already ships npm, so a setup action would be a step that
        // does not exist. Comment-stripped, because the prose names the other PMs' actions.
        expect(withoutComments(yml)).not.toMatch(/action-setup|setup-bun/)
        expect(yml).toContain('cache: npm')
        // `npm ci`, the lockfile-respecting install: `npm install` would rewrite the
        // lockfile it is supposed to be verifying.
        expect(yml).toContain('run: npm ci')
        expect(yml).toContain('npx nuxi prepare')
        expect(yml).toContain('npm run lint')
        expect(yml).toContain('npm audit')
    })

    it('renders bun with setup-bun and no setup-node cache key', async () => {
        const yml = await render('bun')
        expect(yml).toContain('uses: oven-sh/setup-bun@v2')
        expect(yml).toContain('run: bun install --frozen-lockfile')
        expect(yml).toContain('bunx nuxi prepare')
        expect(yml).toContain('bun run lint')
        expect(yml).toContain('bun audit')
        // `actions/setup-node` has no bun cache key, so `cache: bun` fails the workflow
        // on an unaccepted value. A naive `pnpm` to `bun` string swap produces exactly that.
        expect(withoutComments(yml)).not.toMatch(/cache:/)
    })

    it.each(PMS)('keeps every step correctly indented under %s', async (pm) => {
        const yml = await render(pm)
        const steps = yml.slice(yml.indexOf('    steps:') + '    steps:'.length)
        const bodyLines = withoutComments(steps)
            .split('\n')
            .filter((l) => l.trim() !== '')
        // `__PM_SETUP__` substitutes a whole multi-line step, so a botched indent is the
        // likeliest break, and it produces YAML no assertion above would notice.
        expect(bodyLines.every((l) => /^ {6,}/.test(l))).toBe(true)
        for (const l of bodyLines) {
            if (l.trimStart().startsWith('- ')) expect(l).toMatch(/^ {6}- /)
        }
    })

    it.each(PMS)('drops the placeholder line entirely when it renders empty (%s)', async (pm) => {
        // npm has no setup step and bun no cache key, so a leftover blank line inside a
        // `with:` block is legal YAML that reads as an accident in a file users adapt.
        const yml = await render(pm)
        expect(yml).not.toMatch(/\n\n\n/)
    })
})
