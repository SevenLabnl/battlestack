import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ui } from '@battlestack/tui'
import { gitignoreFeature } from '../src/features/gitignore.js'
import { mockRunContext } from './test-utils.js'

let projectDir: string

// The stub `@nuxt/eslint` writes on `nuxi module add`: the exact shape a real scaffold
// hands to this feature, captured from a scaffolded nuxt4-fullstack.
const NUXT_ESLINT_STUB = `// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  // Your custom configs here
)
`

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-ignore-test-'))
    // patchNuxtConfig needs a config to patch; keep it minimal.
    await writeFile(path.join(projectDir, 'nuxt.config.ts'), 'export default defineNuxtConfig({})\n', 'utf8')
})

afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
    vi.restoreAllMocks()
})

function ctx() {
    return mockRunContext({
        projectDir,
        enabledFeatures: new Set(['nuxt4:gitignore']),
        state: { packageManager: 'pnpm' },
    })
}

const readEslint = (): Promise<string> =>
    readFile(path.join(projectDir, 'eslint.config.mjs'), 'utf8')
const readGitignore = (): Promise<string> =>
    readFile(path.join(projectDir, '.gitignore'), 'utf8')

describe('gitignoreFeature: fetched AI-agent skill content (.agents/)', () => {
    it('git-ignores the fetched skill tree', async () => {
        await gitignoreFeature.execute(ctx())
        // Anchored: a bare `.agents` substring would also match e.g. `.agents-old`.
        expect(await readGitignore()).toMatch(/^\.agents\/$/m)
    })

    it('keeps skills-lock.json tracked: it is the record of what was fetched', async () => {
        await gitignoreFeature.execute(ctx())
        expect(await readGitignore()).not.toMatch(/skills-lock/)
    })

    it('eslint-ignores the fetched skill tree in the flat config', async () => {
        await writeFile(path.join(projectDir, 'eslint.config.mjs'), NUXT_ESLINT_STUB, 'utf8')
        await gitignoreFeature.execute(ctx())
        expect(await readEslint()).toContain(".agents/**")
    })

    it('inserts the ignore INSIDE the withNuxt() call, not after it', async () => {
        await writeFile(path.join(projectDir, 'eslint.config.mjs'), NUXT_ESLINT_STUB, 'utf8')
        await gitignoreFeature.execute(ctx())
        const out = await readEslint()
        // An ignore placed outside the call is inert. Assert ordering rather than exact
        // formatting so a reflow does not break this.
        const call = out.indexOf('withNuxt(')
        const ignore = out.indexOf('.agents/**')
        const close = out.indexOf(')', ignore)
        expect(call).toBeGreaterThan(-1)
        expect(ignore).toBeGreaterThan(call)
        expect(close).toBeGreaterThan(ignore)
    })

    it('preserves the user\'s own config content', async () => {
        const withCustom = NUXT_ESLINT_STUB.replace(
            '  // Your custom configs here',
            "  { rules: { 'no-console': 'error' } },",
        )
        await writeFile(path.join(projectDir, 'eslint.config.mjs'), withCustom, 'utf8')
        await gitignoreFeature.execute(ctx())
        expect(await readEslint()).toContain("{ rules: { 'no-console': 'error' } },")
    })

    it('is idempotent across scaffold + repeated pulls', async () => {
        await writeFile(path.join(projectDir, 'eslint.config.mjs'), NUXT_ESLINT_STUB, 'utf8')
        await gitignoreFeature.execute(ctx())
        const afterFirst = await readEslint()
        await gitignoreFeature.update!(ctx(), null)
        await gitignoreFeature.update!(ctx(), null)
        // `pull` re-fires this every run, so a second ignores block would grow unbounded.
        expect(await readEslint()).toBe(afterFirst)
        expect(afterFirst.match(/\.agents\/\*\*/g)).toHaveLength(1)
    })

    it('reports the ignore among the files it wrote on update', async () => {
        await writeFile(path.join(projectDir, 'eslint.config.mjs'), NUXT_ESLINT_STUB, 'utf8')
        const report = await gitignoreFeature.update!(ctx(), null)
        expect(report.written).toContain('eslint.config.mjs')
    })

    it('is a no-op when the project has no flat config (battlestack init on a bare dir)', async () => {
        await expect(gitignoreFeature.execute(ctx())).resolves.toBeUndefined()
    })

    it('warns instead of guessing when the config has no withNuxt() call', async () => {
        const warn = vi.spyOn(ui, 'warn').mockImplementation(() => {})
        const rewritten = "export default [{ rules: {} }]\n"
        await writeFile(path.join(projectDir, 'eslint.config.mjs'), rewritten, 'utf8')
        await gitignoreFeature.execute(ctx())
        // Corrupting a hand-written lint config is worse than leaving it, but silence
        // would hide why `.agents/` is still being linted.
        expect(await readEslint()).toBe(rewritten)
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('.agents/**'))
    })
})

describe('gitignoreFeature: ESLint as the single formatter', () => {
    it('pins vue/html-self-closing to always, so `<img />` keeps its slash', async () => {
        await writeFile(path.join(projectDir, 'eslint.config.mjs'), NUXT_ESLINT_STUB, 'utf8')
        await gitignoreFeature.execute(ctx())
        const cfg = await readEslint()
        expect(cfg).toContain('vue/html-self-closing')
        // `void: 'always'` is the whole point: the plugin default 'never' strips the
        // slash, which is what fought Prettier.
        expect(cfg).toMatch(/void:\s*'always'/)
    })

    it('inserts the formatting rules INSIDE withNuxt(, where eslint sees them', async () => {
        await writeFile(path.join(projectDir, 'eslint.config.mjs'), NUXT_ESLINT_STUB, 'utf8')
        await gitignoreFeature.execute(ctx())
        const cfg = await readEslint()
        // A rules block placed after the closing paren is inert.
        expect(cfg.indexOf('withNuxt(')).toBeLessThan(cfg.indexOf('vue/html-self-closing'))
        expect(cfg.indexOf('vue/html-self-closing')).toBeLessThan(cfg.lastIndexOf(')'))
        // ...and nested under a `rules:` key. Without this a typo'd key still contains
        // the rule name, so every other assertion passes while eslint ignores the block.
        const rulesAt = cfg.search(/\brules:\s*\{/)
        expect(rulesAt).toBeGreaterThan(-1)
        expect(rulesAt).toBeLessThan(cfg.indexOf('vue/html-self-closing'))
    })

    it('writes the stylistic config that replaces .prettierrc.json', async () => {
        await gitignoreFeature.execute(ctx())
        const cfg = await readFile(path.join(projectDir, 'nuxt.config.ts'), 'utf8')
        // The five settings that used to live in .prettierrc.json. Quote style is left
        // open because `eslint --fix` normalises it afterwards; the VALUES are pinned.
        expect(cfg).toMatch(/indent:\s*4/)
        expect(cfg).toMatch(/quotes:\s*['"]single['"]/)
        expect(cfg).toMatch(/semi:\s*false/)
        expect(cfg).toMatch(/commaDangle:\s*['"]always-multiline['"]/)
        expect(cfg).toMatch(/arrowParens:\s*true/)
    })

    // max-len is `fixable: null`, so enabling it produces lint errors `eslint --fix` can
    // never clear: a permanently red gate, to catch one long line per 200-file scaffold.
    it('sets no max-len rule (it is not auto-fixable)', async () => {
        await writeFile(path.join(projectDir, 'eslint.config.mjs'), NUXT_ESLINT_STUB, 'utf8')
        await gitignoreFeature.execute(ctx())
        expect(await readEslint()).not.toMatch(/max-len/)
        expect(await readFile(path.join(projectDir, 'nuxt.config.ts'), 'utf8'))
            .not.toMatch(/printWidth|max-len/)
    })

    it('is idempotent: a second run does not duplicate the rules block', async () => {
        await writeFile(path.join(projectDir, 'eslint.config.mjs'), NUXT_ESLINT_STUB, 'utf8')
        await gitignoreFeature.execute(ctx())
        const once = await readEslint()
        await gitignoreFeature.update!(ctx(), null)
        const twice = await readEslint()
        expect(twice).toBe(once)
        expect(twice.match(/vue\/html-self-closing/g)).toHaveLength(1)
    })

    // The formatting rules use their OWN marker: reusing the fetched-skills one would
    // make the guard return early on older projects, so `pull` would never deliver them.
    it('adds the rules to a project that already has the fetched-skills block', async () => {
        const preExisting = NUXT_ESLINT_STUB.replace(
            'withNuxt(',
            "withNuxt(\n    // battlestack:fetched-skills: managed by @battlestack/preset-nuxt.\n    { ignores: ['.agents/**'] },",
        )
        await writeFile(path.join(projectDir, 'eslint.config.mjs'), preExisting, 'utf8')
        await gitignoreFeature.execute(ctx())
        expect(await readEslint()).toContain('vue/html-self-closing')
    })
})
