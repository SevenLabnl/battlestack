import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
    applyPlugin,
    BattlestackRegistries,
    finalizeRegistries,
    topoOrder,
    type InstalledFeatureRecord,
    type RunContext,
} from '@battlestack/core'

import presetNuxt4 from '../src/index.js'
import { nuxtUiFeature } from '../src/features/nuxt-ui.js'
import { sevenlabUiFeature } from '../src/features/sevenlab-ui.js'
import { NuxtConfig, patchNuxtConfig } from '../src/utils/nuxt-config.js'
import { mockRunContext } from './test-utils.js'

const FEATURE_ID = 'nuxt4:sevenlab-ui'
const BRAND_CSS = 'app/assets/css/brand.css'

let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-sevenlab-ui-test-'))
    await writeFile(path.join(projectDir, 'nuxt.config.ts'), 'export default defineNuxtConfig({})\n', 'utf8')
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

const readConfig = (): Promise<string> => readFile(path.join(projectDir, 'nuxt.config.ts'), 'utf8')

/** The manifest record a real `pull` hands to `update()`, built from the scaffold run. */
function recordFrom(scaffoldCtx: RunContext): InstalledFeatureRecord {
    const files = (scaffoldCtx.state[`files:${FEATURE_ID}`] as Record<string, string>) ?? {}
    return {
        id: FEATURE_ID,
        version: sevenlabUiFeature.version,
        files: { ...files },
        ownedByUser: sevenlabUiFeature.structuralFiles!(scaffoldCtx),
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

describe('sevenlabUiFeature: registration', () => {
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

    it('is offered and default-on in all three templates', () => {
        const registries = realRegistries()
        // Off the finalized registry, never hand-spelled: these lists are canonicalized
        // to fqids, and a literal would pass with and without that pass.
        const fqid = registries.features.get(FEATURE_ID).fqid
        for (const id of ['nuxt4-minimal', 'nuxt4-fullstack', 'nuxt4-ai']) {
            const tpl = registries.templates.get(id)
            expect(tpl.optionalFeatures, id).toContain(fqid)
            expect(tpl.defaultEnabledOptional, id).toContain(fqid)
            // Optional, deliberately: `@sevenlab/ui-default` is private and this preset
            // is published, so a public scaffold has to be able to switch it off.
            expect(tpl.requiredFeatures, id).not.toContain(fqid)
        }
    })

    // Asserted through the real orderer, not by reading `after`: the theme layer's Nuxt UI
    // bridge is only the last word on styling if it is also the last to patch nuxt.config.
    it('runs after nuxt4:nuxt-ui', () => {
        const ordered = topoOrder([sevenlabUiFeature, nuxtUiFeature]).map((f) => f.id)
        expect(ordered.indexOf(FEATURE_ID)).toBeGreaterThan(ordered.indexOf('nuxt4:nuxt-ui'))
    })
})

describe('sevenlabUiFeature: dependencies', () => {
    it('declares the theme package as a prod dependency', () => {
        expect(sevenlabUiFeature.collectDeps?.(ctx())?.prod).toEqual(['@sevenlab/ui-default'])
    })

    // `@sevenlab/ui-default` depends on `@sevenlab/ui`, so declaring both would pin two
    // versions the app has to keep in lockstep by hand.
    it('does not declare the component library directly', () => {
        const deps = sevenlabUiFeature.collectDeps?.(ctx()) ?? {}
        expect([...(deps.prod ?? []), ...(deps.dev ?? [])]).not.toContain('@sevenlab/ui')
    })

    it('registers no Nuxt module: the design system arrives as a layer, not a module', () => {
        expect(sevenlabUiFeature.collectModules?.(ctx()) ?? []).toEqual([])
    })
})

describe('sevenlabUiFeature: emitted files', () => {
    it('emits the brand stylesheet and the design-system instruction file', async () => {
        await sevenlabUiFeature.execute(ctx())
        await expect(readFile(path.join(projectDir, BRAND_CSS), 'utf8')).resolves.toContain(':root')
        await expect(readFile(path.join(projectDir, 'DESIGN_SYSTEM.md'), 'utf8'))
            .resolves.toContain('# Design system')
    })

    /**
     * The point of the whole package split: a fix in `BsButton` reaches every project
     * through a version bump, not through eight divergent copies. An emitted component
     * would be a copy, so this asserts on the whole emitted tree rather than on a name.
     */
    it('emits no component source', async () => {
        const emitCtx = ctx()
        await sevenlabUiFeature.execute(emitCtx)
        const emitted = Object.keys(emitCtx.state[`files:${FEATURE_ID}`] as Record<string, string>)
        expect(emitted.sort()).toEqual(['DESIGN_SYSTEM.md', BRAND_CSS])
        await expect(readdir(path.join(projectDir, 'app', 'components'))).rejects.toThrow()
    })

    // Without this, `battlestack pull` overwrites the project's own brand every time.
    it('marks the brand stylesheet as user-owned, and only that', () => {
        expect(sevenlabUiFeature.structuralFiles!(ctx())).toEqual([BRAND_CSS])
    })

    // DESIGN_SYSTEM.md is the design system's own instruction file, not the project's:
    // `pull` has to be able to deliver a corrected version of it.
    it('does not claim DESIGN_SYSTEM.md as user-owned', () => {
        expect(sevenlabUiFeature.structuralFiles!(ctx())).not.toContain('DESIGN_SYSTEM.md')
    })
})

describe('sevenlabUiFeature: nuxt.config wiring', () => {
    it('extends the theme layer and registers the brand stylesheet', async () => {
        await sevenlabUiFeature.execute(ctx())
        const cfg = await readConfig()
        expect(cfg).toMatch(/extends:\s*\[\s*["']@sevenlab\/ui-default["']/)
        expect(cfg).toContain('~/assets/css/brand.css')
    })

    // Both stylesheets are unlayered, so source order decides. brand.css last means a
    // project override outranks the design system's own token values.
    it('registers brand.css after nuxt-ui\'s main.css', async () => {
        await nuxtUiFeature.execute(ctx())
        await sevenlabUiFeature.execute(ctx())
        const cfg = await readConfig()
        expect(cfg.indexOf('main.css')).toBeGreaterThan(-1)
        expect(cfg.indexOf('brand.css')).toBeGreaterThan(cfg.indexOf('main.css'))
    })

    it('leaves a hand-written config entry alone', async () => {
        await writeFile(
            path.join(projectDir, 'nuxt.config.ts'),
            "export default defineNuxtConfig({\n    extends: ['./layers/legacy'],\n    ssr: false,\n})\n",
            'utf8',
        )
        await sevenlabUiFeature.execute(ctx())
        const cfg = await readConfig()
        expect(cfg).toContain('./layers/legacy')
        expect(cfg).toContain('ssr: false')
        // Appended, never prepended: among layers the earliest entry wins, so an
        // existing layer keeps the precedence it had.
        expect(cfg.indexOf('@sevenlab/ui-default')).toBeGreaterThan(cfg.indexOf('./layers/legacy'))
    })
})

describe('sevenlabUiFeature: update is idempotent', () => {
    it('converges on repeated pulls without duplicating config entries', async () => {
        const scaffold = ctx()
        await sevenlabUiFeature.execute(scaffold)
        const prev = recordFrom(scaffold)
        const afterScaffold = await readConfig()

        await sevenlabUiFeature.update!(ctx(), prev)
        const report = await sevenlabUiFeature.update!(ctx(), prev)

        const cfg = await readConfig()
        expect(cfg).toBe(afterScaffold)
        expect(cfg.match(/@sevenlab\/ui-default/g)).toHaveLength(1)
        expect(cfg.match(/brand\.css/g)).toHaveLength(1)
        expect(report.skipped).toEqual([])
    })

    // The user's own brand values are the one thing `pull` must never take back.
    it('keeps a user-edited brand.css', async () => {
        const scaffold = ctx()
        await sevenlabUiFeature.execute(scaffold)
        const prev = recordFrom(scaffold)

        const edited = ':root {\n    --primary: #ff0000;\n}\n'
        await writeFile(path.join(projectDir, BRAND_CSS), edited, 'utf8')

        const report = await sevenlabUiFeature.update!(ctx(), prev)
        expect(await readFile(path.join(projectDir, BRAND_CSS), 'utf8')).toBe(edited)
        expect(report.skipped).not.toContain(BRAND_CSS)
    })

    // Not user-owned, so a corrected instruction file reaches existing projects.
    it('restores DESIGN_SYSTEM.md when the project deleted it', async () => {
        const scaffold = ctx()
        await sevenlabUiFeature.execute(scaffold)
        const prev = recordFrom(scaffold)
        await rm(path.join(projectDir, 'DESIGN_SYSTEM.md'))

        const report = await sevenlabUiFeature.update!(ctx(), prev)
        expect(report.written).toContain('DESIGN_SYSTEM.md')
        await expect(readFile(path.join(projectDir, 'DESIGN_SYSTEM.md'), 'utf8'))
            .resolves.toContain('# Design system')
    })
})

describe('sevenlabUiFeature: docs', () => {
    it('documents the layer model in both README and AGENTS', () => {
        const sections = sevenlabUiFeature.collectDocs?.(ctx()) ?? []
        expect(sections).toHaveLength(1)
        const [section] = sections
        expect(section!.targets).toEqual(['readme', 'agents'])
        for (const pkg of ['@sevenlab/ui', '@sevenlab/ui-default', '@sevenlab/ui-<client>']) {
            expect(section!.body).toContain(pkg)
        }
        // The two rules the section exists to state.
        expect(section!.body).toContain('DESIGN_SYSTEM.md')
        expect(section!.body).toContain(BRAND_CSS)
    })
})

describe('DESIGN_SYSTEM.md', () => {
    let doc: string

    beforeEach(async () => {
        await sevenlabUiFeature.execute(ctx())
        doc = await readFile(path.join(projectDir, 'DESIGN_SYSTEM.md'), 'utf8')
    })

    it('names the three layers as real packages', () => {
        expect(doc).toContain('@sevenlab/ui`')
        expect(doc).toContain('@sevenlab/ui-default`')
        expect(doc).toContain('@sevenlab/ui-<client>`')
    })

    it('names real components, with the Bs prefix they actually register under', () => {
        for (const name of ['BsButton', 'BsDataTable', 'BsAppShell', 'BsCombobox']) {
            expect(doc).toContain(name)
        }
    })

    it('documents the three gates', () => {
        expect(doc).toContain('check:ds')
        for (const gate of ['check:contrast', 'check:contract', 'check:layers']) {
            expect(doc).toContain(gate)
        }
    })

    // The correction that matters most for an agent: the export's own paths
    // (`design-system-source/`, `.prompt.md`, `ui_kits/app/`) do not exist in a
    // scaffolded project, so pointing at them sends it looking for nothing.
    it('points only at paths that exist in a scaffolded project', () => {
        for (const stale of ['design-system-source/', '.prompt.md', 'ui_kits/']) {
            expect(doc).not.toContain(stale)
        }
        expect(doc).toContain('node_modules/@sevenlab/ui-default/tokens/tokens.json')
    })
})

describe('NuxtConfig.addExtends', () => {
    const read = (): Promise<string> => readConfig()

    it('creates the extends array when the config has none', async () => {
        await patchNuxtConfig(projectDir, (c) => c.addExtends('@sevenlab/ui-default'))
        expect(await read()).toMatch(/extends:\s*\[["']@sevenlab\/ui-default["']\]/)
    })

    it('appends to an existing array, preserving order', async () => {
        await writeFile(
            path.join(projectDir, 'nuxt.config.ts'),
            "export default defineNuxtConfig({\n    extends: ['./layers/base'],\n})\n",
            'utf8',
        )
        await patchNuxtConfig(projectDir, (c) => c.addExtends('@sevenlab/ui-default'))
        const cfg = await read()
        expect(cfg.indexOf('./layers/base')).toBeLessThan(cfg.indexOf('@sevenlab/ui-default'))
    })

    it('is idempotent: a repeated add does not duplicate the entry', async () => {
        await patchNuxtConfig(projectDir, (c) => c.addExtends('@sevenlab/ui-default'))
        const once = await read()
        await patchNuxtConfig(projectDir, (c) => c.addExtends('@sevenlab/ui-default'))
        expect(await read()).toBe(once)
        expect(once.match(/@sevenlab\/ui-default/g)).toHaveLength(1)
    })

    it('chains, like every other NuxtConfig mutator', async () => {
        const cfg = await NuxtConfig.load(projectDir)
        expect(cfg.addExtends('@sevenlab/ui-default')).toBe(cfg)
    })

    it('leaves the rest of the config untouched', async () => {
        await writeFile(
            path.join(projectDir, 'nuxt.config.ts'),
            "export default defineNuxtConfig({\n    ssr: false,\n    modules: ['@nuxt/ui'],\n})\n",
            'utf8',
        )
        await patchNuxtConfig(projectDir, (c) => c.addExtends('@sevenlab/ui-default'))
        const cfg = await read()
        expect(cfg).toContain('ssr: false')
        expect(cfg).toMatch(/modules:\s*\[["']@nuxt\/ui["']\]/)
    })
})
