import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
    applyPlugin,
    BattlestackRegistries,
    finalizeRegistries,
    hashFile,
    topoOrder,
    type InstalledFeatureRecord,
    type RunContext,
} from '@battlestack/core'

import presetNuxt4 from '../src/index.js'
import { nuxtUiFeature } from '../src/features/nuxt-ui.js'
import { landingShellFeature } from '../src/features/landing-shell.js'
import { aiToolConfigFeature } from '../src/features/ai-tool-config.js'
import { battlestackThemeFeature } from '../src/features/battlestack-theme.js'
import { mockRunContext } from './test-utils.js'

const FEATURE_ID = 'nuxt4:battlestack-theme'
const BRAND_CSS = 'app/assets/css/brand.css'
const MAIN_CSS = 'app/assets/css/main.css'
const APP_CONFIG = 'app/app.config.ts'

const templatesRoot = fileURLToPath(new URL('../templates', import.meta.url))

let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-theme-test-'))
    await writeFile(path.join(projectDir, 'nuxt.config.ts'), 'export default defineNuxtConfig({})\n', 'utf8')
    // The state `nuxt4:nuxt-ui` leaves behind, straight from its real template so this
    // suite breaks when that template drifts instead of silently testing a stale copy.
    await mkdir(path.join(projectDir, 'app/assets/css'), { recursive: true })
    for (const rel of [MAIN_CSS, APP_CONFIG]) {
        const content = await readFile(path.join(templatesRoot, 'nuxt-ui', rel), 'utf8')
        await writeFile(path.join(projectDir, rel), content, 'utf8')
    }
})

afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
})

function ctx(): RunContext {
    return mockRunContext({
        projectDir,
        enabledFeatures: new Set([FEATURE_ID]),
        state: { packageManager: 'pnpm' },
    })
}

const read = (rel: string): Promise<string> => readFile(path.join(projectDir, rel), 'utf8')

/** The manifest record a real `pull` hands to `update()`, built from the scaffold run. */
function recordFrom(scaffoldCtx: RunContext): InstalledFeatureRecord {
    const files = (scaffoldCtx.state[`files:${FEATURE_ID}`] as Record<string, string>) ?? {}
    return {
        id: FEATURE_ID,
        version: battlestackThemeFeature.version,
        files: { ...files },
        ownedByUser: battlestackThemeFeature.structuralFiles!(scaffoldCtx),
    }
}

/** The real loader path, same as the CLI runs at startup. */
function realRegistries(): BattlestackRegistries {
    const registries = new BattlestackRegistries()
    const { extensions } = applyPlugin(presetNuxt4, 'bundled', registries)
    // An unexpected finalize warning means the preset isn't the shape this suite assumes.
    expect(finalizeRegistries(registries, extensions)).toEqual([])
    return registries
}

describe('battlestackThemeFeature: registration', () => {
    it('is registered by the preset, resolvable by the id features spell it with', () => {
        const feature = realRegistries().features.get(FEATURE_ID)
        expect(feature.id).toBe(FEATURE_ID)
        expect(feature.stage).toBe('STYLING')
    })

    // Not the same list as the templates: this one gates `battlestack add`, so a feature
    // missing here can be scaffolded but never added to an existing project.
    it('is in the nuxt4 framework catalogue', () => {
        const registries = realRegistries()
        expect(registries.frameworks.get('nuxt4').supportedFeatures)
            .toContain(registries.features.get(FEATURE_ID).fqid)
    })

    it('is offered but default-OFF in all three templates', () => {
        const registries = realRegistries()
        // Off the finalized registry, never hand-spelled: these lists are canonicalized
        // to fqids, and a literal would pass with and without that pass.
        const fqid = registries.features.get(FEATURE_ID).fqid
        for (const id of ['nuxt4-minimal', 'nuxt4-fullstack', 'nuxt4-ai']) {
            const tpl = registries.templates.get(id)
            expect(tpl.optionalFeatures, id).toContain(fqid)
            // Default-OFF, deliberately: `@battlestack/theme` is not on a registry yet
            // and this preset is published, so any default that pulls the dependency in
            // (required OR default-on) breaks `battlestack create` at install time for
            // everyone accepting the defaults. Flip once the package is published.
            expect(tpl.defaultEnabledOptional, id).not.toContain(fqid)
            expect(tpl.requiredFeatures, id).not.toContain(fqid)
        }
    })

    // Asserted through the real orderer, not by reading `requires`: the theme patches
    // files `nuxt4:nuxt-ui` emits, so it is only correct if it is also ordered later.
    it('runs after nuxt4:nuxt-ui', () => {
        const ordered = topoOrder([battlestackThemeFeature, nuxtUiFeature]).map((f) => f.id)
        expect(ordered.indexOf(FEATURE_ID)).toBeGreaterThan(ordered.indexOf('nuxt4:nuxt-ui'))
    })
})

describe('battlestackThemeFeature: dependencies', () => {
    it('declares the theme layer as a prod dependency, and nothing else', () => {
        const deps = battlestackThemeFeature.collectDeps?.(ctx()) ?? {}
        expect(deps.prod).toEqual(['@battlestack/theme'])
        expect(deps.dev ?? []).toEqual([])
    })

    it('registers no Nuxt module: the theme arrives as a layer, not a module', () => {
        expect(battlestackThemeFeature.collectModules?.(ctx()) ?? []).toEqual([])
    })
})

describe('battlestackThemeFeature: emitted files', () => {
    it('emits the brand stylesheet and the design-system instruction file', async () => {
        await battlestackThemeFeature.execute(ctx())
        await expect(read(BRAND_CSS)).resolves.toContain(':root')
        await expect(read('DESIGN_SYSTEM.md')).resolves.toContain('# Design system')
    })

    /**
     * The point of the rework: Nuxt UI is the component library and the design system is
     * a theme. Nothing that looks like a component may be emitted into the app — a copy
     * would diverge, and a divergent copy is the failure mode this PR removes.
     */
    it('emits no component source', async () => {
        const emitCtx = ctx()
        await battlestackThemeFeature.execute(emitCtx)
        const emitted = Object.keys(emitCtx.state[`files:${FEATURE_ID}`] as Record<string, string>)
        // Recorded rels are platform-separated; compare in posix form.
        expect(emitted.map((r) => r.replaceAll(path.sep, '/')).sort()).toEqual(['DESIGN_SYSTEM.md', BRAND_CSS])
        await expect(readdir(path.join(projectDir, 'app', 'components'))).rejects.toThrow()
    })

    // Without this, `battlestack pull` overwrites the project's own brand every time.
    // Platform-separated on purpose: manifest keys come from `path.join`, so a posix
    // literal here would miss on Windows and `pull` would overwrite brand.css.
    it('marks the brand stylesheet as user-owned, and only that', async () => {
        const scaffold = ctx()
        await battlestackThemeFeature.execute(scaffold)
        expect(battlestackThemeFeature.structuralFiles!(scaffold)).toEqual([path.join(BRAND_CSS)])
    })

    // Nothing recorded yet means nothing to claim — a claim on a file this feature has
    // not emitted would make `pull` skip writing it while the wiring still references it.
    it('claims no files before it has emitted any', () => {
        expect(battlestackThemeFeature.structuralFiles!(ctx())).toEqual([])
    })
})

describe('battlestackThemeFeature: wiring', () => {
    it('extends the theme layer in nuxt.config', async () => {
        await battlestackThemeFeature.execute(ctx())
        expect(await read('nuxt.config.ts')).toMatch(/extends:\s*\[\s*["']@battlestack\/theme["']/)
    })

    // Nuxt accepts `extends` as a bare string; without normalization the add would
    // throw `extends.push is not a function` and abort.
    it('handles a bare-string extends entry', async () => {
        await writeFile(
            path.join(projectDir, 'nuxt.config.ts'),
            "export default defineNuxtConfig({\n    extends: './layers/legacy',\n})\n",
            'utf8',
        )
        await battlestackThemeFeature.execute(ctx())
        const cfg = await read('nuxt.config.ts')
        expect(cfg).toContain('./layers/legacy')
        expect(cfg).toMatch(/extends:\s*\[/)
        expect(cfg.indexOf('@battlestack/theme')).toBeGreaterThan(cfg.indexOf('./layers/legacy'))
    })

    it('leaves a hand-written config entry alone, appending after it', async () => {
        await writeFile(
            path.join(projectDir, 'nuxt.config.ts'),
            "export default defineNuxtConfig({\n    extends: ['./layers/legacy'],\n    ssr: false,\n})\n",
            'utf8',
        )
        await battlestackThemeFeature.execute(ctx())
        const cfg = await read('nuxt.config.ts')
        expect(cfg).toContain('./layers/legacy')
        expect(cfg).toContain('ssr: false')
        // Appended, never prepended: among layers the earliest entry wins, so an
        // existing layer keeps the precedence it had.
        expect(cfg.indexOf('@battlestack/theme')).toBeGreaterThan(cfg.indexOf('./layers/legacy'))
    })

    // `@theme` only takes effect inside the stylesheet that imports tailwindcss, which is
    // why the tokens are imported here and not loaded by the layer.
    it('imports tokens.css then brand.css in main.css, after @nuxt/ui', async () => {
        await battlestackThemeFeature.execute(ctx())
        const css = await read(MAIN_CSS)
        const order = ['@import "tailwindcss"', '@import "@nuxt/ui"', '@import "@battlestack/theme/tokens.css"', '@import "./brand.css"']
        const positions = order.map((s) => css.indexOf(s))
        expect(positions.every((p) => p >= 0)).toBe(true)
        expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    })

    // A commented-out @import must not anchor the insertion: splicing inside the
    // `/* … */` block would silently disable the whole theme, and the includes()
    // guard would then skip the repair on every future pull.
    it('never splices the imports into a CSS comment', async () => {
        await writeFile(
            path.join(projectDir, MAIN_CSS),
            '@import "tailwindcss";\n@import "@nuxt/ui";\n/*\n@import "./legacy.css";\n*/\n.brand { color: red }\n',
            'utf8',
        )
        await battlestackThemeFeature.execute(ctx())
        const css = await read(MAIN_CSS)
        const commentStart = css.indexOf('/*')
        for (const line of ['@import "@battlestack/theme/tokens.css";', '@import "./brand.css";']) {
            expect(css.indexOf(line)).toBeGreaterThan(css.indexOf('@import "@nuxt/ui";'))
            expect(css.indexOf(line)).toBeLessThan(commentStart)
        }
    })

    // CSS rejects an @import that follows a rule, so insertion goes after the last
    // import, never at end-of-file.
    it('keeps imports valid when the project appended its own rules to main.css', async () => {
        await writeFile(
            path.join(projectDir, MAIN_CSS),
            '@import "tailwindcss";\n@import "@nuxt/ui";\n\n.custom { color: red; }\n',
            'utf8',
        )
        await battlestackThemeFeature.execute(ctx())
        const css = await read(MAIN_CSS)
        expect(css.indexOf('@import "./brand.css";')).toBeLessThan(css.indexOf('.custom'))
    })

    it('points the semantic aliases at the theme ramps', async () => {
        await battlestackThemeFeature.execute(ctx())
        const config = await read(APP_CONFIG)
        expect(config).toContain("primary: 'brand'")
        expect(config).toContain("secondary: 'lilac'")
        expect(config).toContain("neutral: 'stone'")
        expect(config).not.toContain("'blue'")
    })

    // Only the scaffold defaults are rewritten: a changed alias is a project decision,
    // and `pull` taking it back would be the tool fighting the user.
    it('leaves a project-chosen alias alone', async () => {
        const config = (await read(APP_CONFIG)).replace("primary: 'blue'", "primary: 'indigo'")
        await writeFile(path.join(projectDir, APP_CONFIG), config, 'utf8')
        await battlestackThemeFeature.execute(ctx())
        const after = await read(APP_CONFIG)
        expect(after).toContain("primary: 'indigo'")
        expect(after).toContain("neutral: 'stone'")
    })
})

describe('battlestackThemeFeature: update is idempotent', () => {
    it('converges on repeated pulls without duplicating entries', async () => {
        const scaffold = ctx()
        await battlestackThemeFeature.execute(scaffold)
        const prev = recordFrom(scaffold)
        const afterScaffold = await Promise.all([read('nuxt.config.ts'), read(MAIN_CSS), read(APP_CONFIG)])

        await battlestackThemeFeature.update!(ctx(), prev)
        const report = await battlestackThemeFeature.update!(ctx(), prev)

        const after = await Promise.all([read('nuxt.config.ts'), read(MAIN_CSS), read(APP_CONFIG)])
        expect(after).toEqual(afterScaffold)
        expect(after[1].match(/@battlestack\/theme\/tokens\.css/g)).toHaveLength(1)
        expect(after[1].match(/brand\.css/g)).toHaveLength(1)
        expect(report.skipped).toEqual([])
    })

    // The user's own brand values are the one thing `pull` must never take back.
    it('keeps a user-edited brand.css', async () => {
        const scaffold = ctx()
        await battlestackThemeFeature.execute(scaffold)
        const prev = recordFrom(scaffold)

        const edited = ':root {\n    --ui-radius: 0.5rem;\n}\n.dark {\n    --ui-radius: 0.5rem;\n}\n'
        await writeFile(path.join(projectDir, BRAND_CSS), edited, 'utf8')

        const report = await battlestackThemeFeature.update!(ctx(), prev)
        expect(await read(BRAND_CSS)).toBe(edited)
        expect(report.skipped).not.toContain(BRAND_CSS)
    })

    // Not user-owned, so a corrected instruction file reaches existing projects.
    it('restores DESIGN_SYSTEM.md when the project deleted it', async () => {
        const scaffold = ctx()
        await battlestackThemeFeature.execute(scaffold)
        const prev = recordFrom(scaffold)
        await rm(path.join(projectDir, 'DESIGN_SYSTEM.md'))

        const report = await battlestackThemeFeature.update!(ctx(), prev)
        expect(report.written).toContain('DESIGN_SYSTEM.md')
        await expect(read('DESIGN_SYSTEM.md')).resolves.toContain('# Design system')
    })
})

describe('battlestackThemeFeature: patched files stay in baseline', () => {
    /**
     * The theme string-patches files other features recorded. Without moving those
     * baselines to the patched bytes, every themed project gets two permanent
     * "drifted" entries in `doctor` and staged `.new`/`.patch` conflicts on every
     * `pull` — verified here through `nuxt4:nuxt-ui`'s real update path.
     */
    it('re-baselines nuxt-ui\'s recorded hashes for main.css and app.config.ts', async () => {
        // Platform-separated, exactly as the emit path records them (`app\...` on Windows).
        const mainCssRel = path.join(MAIN_CSS)
        const appConfigRel = path.join(APP_CONFIG)
        const runCtx = ctx()
        // What `nuxt4:nuxt-ui` recorded at scaffold time, before the theme patched the files.
        runCtx.state['files:nuxt4:nuxt-ui'] = {
            [mainCssRel]: await hashFile(path.join(projectDir, MAIN_CSS)),
            [appConfigRel]: await hashFile(path.join(projectDir, APP_CONFIG)),
        }
        await battlestackThemeFeature.execute(runCtx)

        const recorded = runCtx.state['files:nuxt4:nuxt-ui'] as Record<string, string>
        expect(recorded[mainCssRel]).toBe(await hashFile(path.join(projectDir, MAIN_CSS)))
        expect(recorded[appConfigRel]).toBe(await hashFile(path.join(projectDir, APP_CONFIG)))

        // The proof that matters: nuxt-ui's own update sees no drift on the next pull.
        const prev: InstalledFeatureRecord = {
            id: 'nuxt4:nuxt-ui',
            version: nuxtUiFeature.version,
            files: { ...recorded },
        }
        const report = await nuxtUiFeature.update!(ctx(), prev)
        expect(report.skipped).toEqual([])
    })

    // The re-baseline hashes the whole file, so it must move only baselines that matched
    // the pre-splice bytes: blessing a user-drifted file would let the next nuxt-ui bump
    // classify it as pristine and overwrite the user's rules with nothing staged.
    it('does not bless user drift in main.css while splicing', async () => {
        const mainCssRel = path.join(MAIN_CSS)
        const staleHash = 'a'.repeat(64) // nuxt-ui's baseline from before the user edited
        await writeFile(
            path.join(projectDir, MAIN_CSS),
            (await read(MAIN_CSS)) + '\n.user-rule { color: red }\n',
            'utf8',
        )
        const runCtx = ctx()
        runCtx.state['files:nuxt4:nuxt-ui'] = { [mainCssRel]: staleHash }

        await battlestackThemeFeature.execute(runCtx)

        // The splice happened, but nuxt-ui's stale baseline stays stale: real drift.
        await expect(read(MAIN_CSS)).resolves.toContain('@battlestack/theme/tokens.css')
        const recorded = runCtx.state['files:nuxt4:nuxt-ui'] as Record<string, string>
        expect(recorded[mainCssRel]).toBe(staleHash)
    })
})

describe('battlestackThemeFeature: sibling features', () => {
    // `battlestack add nuxt4:landing-shell` re-emits app.config.ts with the scaffold
    // defaults and runs only landing-shell's execute() — which must re-apply the
    // theme's aliases itself, or the themed project silently loses its brand ramps.
    it('landing-shell re-applies the color aliases on a themed project', async () => {
        await battlestackThemeFeature.execute(ctx())
        const addCtx = mockRunContext({
            projectDir,
            enabledFeatures: new Set([FEATURE_ID, 'nuxt4:landing-shell']),
            state: { packageManager: 'pnpm' },
        })
        await landingShellFeature.execute(addCtx)
        const config = await read(APP_CONFIG)
        expect(config).toContain("primary: 'brand'")
        expect(config).toContain("secondary: 'lilac'")
        expect(config).toContain("neutral: 'stone'")
    })

    // A nuxt-ui-only bump re-emits main.css from the template: the spliced copy hashes
    // as pristine, so the update overwrites it — and must then restore the splice, or
    // every themed project silently loses its tokens on the next `battlestack pull`.
    it('nuxt-ui\'s update keeps the theme\'s spliced imports in main.css', async () => {
        const scaffoldCtx = ctx()
        scaffoldCtx.state['files:nuxt4:nuxt-ui'] = {
            [path.join(MAIN_CSS)]: await hashFile(path.join(projectDir, MAIN_CSS)),
        }
        await battlestackThemeFeature.execute(scaffoldCtx)

        const pullCtx = mockRunContext({
            projectDir,
            enabledFeatures: new Set([FEATURE_ID, 'nuxt4:nuxt-ui']),
            state: { packageManager: 'pnpm' },
        })
        const prev: InstalledFeatureRecord = {
            id: 'nuxt4:nuxt-ui',
            version: '0.0.1', // any older version: only update() matters here
            files: { ...(scaffoldCtx.state['files:nuxt4:nuxt-ui'] as Record<string, string>) },
        }
        await nuxtUiFeature.update!(pullCtx, prev)

        const css = await read(MAIN_CSS)
        expect(css).toContain('@import "@battlestack/theme/tokens.css";')
        expect(css).toContain('@import "./brand.css";')
        // And the re-splice moved the baseline with it: no phantom drift next pull.
        const recorded = pullCtx.state['files:nuxt4:nuxt-ui'] as Record<string, string>
        expect(recorded[path.join(MAIN_CSS)]).toBe(await hashFile(path.join(projectDir, MAIN_CSS)))
    })

    it('landing-shell keeps the scaffold defaults when the theme is off', async () => {
        const addCtx = mockRunContext({
            projectDir,
            enabledFeatures: new Set(['nuxt4:landing-shell']),
            state: { packageManager: 'pnpm' },
        })
        await landingShellFeature.execute(addCtx)
        expect(await read(APP_CONFIG)).toContain("primary: 'blue'")
    })

    // The skill tells agents to read DESIGN_SYSTEM.md/brand.css and treat the theme
    // as installed — confidently wrong context in a project that switched it off.
    it('ai-tool-config gates the battlestack-ui skill on the theme feature', async () => {
        const SKILL = '.claude/skills/battlestack-ui/SKILL.md'
        // State keys are platform-separated; `read` takes the posix form either way.
        const skillKey = path.join(SKILL)

        const withTheme = ctx()
        await aiToolConfigFeature.execute(withTheme)
        await expect(read(SKILL)).resolves.toContain('battlestack-ui')
        expect(withTheme.state['files:shared:ai-tool-config']).toHaveProperty([skillKey])

        await rm(path.join(projectDir, '.claude'), { recursive: true, force: true })

        const withoutTheme = mockRunContext({ projectDir, enabledFeatures: new Set(), state: {} })
        await aiToolConfigFeature.execute(withoutTheme)
        await expect(read(SKILL)).rejects.toThrow()
        expect(withoutTheme.state['files:shared:ai-tool-config']).not.toHaveProperty([skillKey])
    })
})

describe('battlestackThemeFeature: docs', () => {
    it('documents the theme model in both README and AGENTS', () => {
        const sections = battlestackThemeFeature.collectDocs?.(ctx()) ?? []
        expect(sections).toHaveLength(1)
        const [section] = sections
        expect(section!.targets).toEqual(['readme', 'agents'])
        // The rules the section exists to state.
        expect(section!.body).toContain('Nuxt UI is the component library')
        expect(section!.body).toContain('@battlestack/theme')
        expect(section!.body).toContain('brand.css')
        expect(section!.body).toContain('never invent a name')
    })
})
