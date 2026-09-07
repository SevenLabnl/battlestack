import path from 'node:path'
import { readJson, writeJson, STAGE, type Feature, type RunContext } from '@battlestack/core'
import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'
import { patchNuxtConfig } from '../utils/nuxt-config.js'

/** Navy plate from the battlestack icon pack. Matches `pwa.manifest.theme_color`. */
const BRAND_NAVY = '#0D1520'

/** Posix-declared; `structuralFiles()` converts to the platform separator. */
const ICON_FILES = [
    'public/favicon.ico',
    'public/favicon.svg',
    'public/apple-touch-icon.png',
] as const

/** Always-on Nuxt essentials: `@nuxt/eslint`, `@nuxt/fonts`, `@nuxt/image`, datepicker, `@iconify/vue`. */
export const essentialsFeature: Feature = {
    id: 'nuxt4:essentials',
    version: '1.1.0',
    label: 'Nuxt essentials (eslint, fonts, image, iconify, datepicker, nodemailer)',
    frameworks: ['nuxt4'],
    stage: STAGE.BASE_CONFIG,

    collectModules() {
        return ['@nuxt/eslint', '@nuxt/fonts', '@nuxt/image']
    },

    collectDeps() {
        return {
            prod: ['@vuepic/vue-datepicker', '@iconify/vue'],
            // `@iconify-json/lucide` is a local icon bundle. eslint/typescript/vue-tsc are explicit.
            dev: ['@iconify-json/lucide', 'eslint', 'typescript', 'vue-tsc'],
        }
    },

    collectDocs() {
        return [
            {
                heading: 'Datepicker',
                body: [
                    'Use `@vuepic/vue-datepicker` for all date/calendar needs. The Nuxt UI calendar is **not** used in this codebase: its keyboard semantics and locale support are too thin for our forms.',
                    '',
                    'Reference component: `app/components/ExampleCalendar.vue` shows the canonical wiring. Copy from there when adding a new date input.',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
            {
                heading: 'Search engine indexing',
                body: [
                    '`public/robots.txt` blocks all crawlers by default (`Disallow: /`), because these apps are internal/back-office, not public sites. If a project should be indexed, edit (or delete) `public/robots.txt`.',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
            {
                heading: 'Favicon and app icons',
                body: [
                    'The scaffold ships SevenLab branding at `public/favicon.ico`, `public/favicon.svg` and `public/apple-touch-icon.png`, wired into `nuxt.config.ts#app.head.link`. They replace the Nuxt-logo favicon that `nuxi init` leaves behind.',
                    '',
                    'These three paths are **user-owned**: once they exist, `battlestack pull` never touches them. Replace them with the client\'s own branding and the update path will leave your version alone. Keep the filenames — the `<link>` tags in `nuxt.config.ts` point at them. A project scaffolded before the icon pack shipped gets them written once, on the pull that introduces them, and they are user-owned from then on.',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    /**
     * Branding: every project replaces these with the client's own icons.
     *
     * Only paths this feature has actually recorded are claimed. Claiming all of `ICON_FILES`
     * unconditionally would also claim them on a project scaffolded before they shipped, where
     * `classifyForUpdate` reaches `owned` before it ever tests `!exists(dest)`, so `pull` would
     * skip writing an icon that is not there while `wireIcons` still adds the `<link>`.
     */
    structuralFiles(ctx) {
        // Manifest keys come from `path.join` in `walkTemplateFiles`, so they carry the
        // platform separator. Returning the posix literals verbatim would miss on
        // Windows and let `pull` overwrite a project's branding.
        const recorded = (ctx.state[`files:${this.id}`] as Record<string, string> | undefined) ?? {}
        return ICON_FILES
            .map((rel) => rel.split('/').join(path.sep))
            .filter((rel) => rel in recorded)
    },

    async execute(ctx) {
        await emitTemplate(ctx, 'nuxt4:essentials', import.meta.url, 'essentials')
        await wireScripts(ctx)
        await wireIcons(ctx)
    },

    async update(ctx, prev) {
        const report = await emitTemplateUpdate(ctx, 'nuxt4:essentials', import.meta.url, 'essentials', prev)
        await wireScripts(ctx)
        await wireIcons(ctx)
        return report
    },
}

async function wireScripts(ctx: RunContext): Promise<void> {
    const pkgPath = path.join(ctx.projectDir, 'package.json')
    const pkg = await readJson<Record<string, unknown>>(pkgPath)
    const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {}
    scripts.lint = 'eslint .'
    scripts['lint:fix'] = 'eslint . --fix'
    scripts.typecheck = 'nuxi typecheck'
    pkg.scripts = scripts
    await writeJson(pkgPath, pkg)
}

/**
 * Points the document head at our icon set, mirroring `icon-pack/head.html` from the
 * battlestack icon pack. `nuxi init` only leaves a bare `public/favicon.ico`, so
 * without these the SVG and the iOS icon go unused.
 *
 * Lives in `nuxt.config.ts` (plain data, serializes fine) rather than `app/app.vue`,
 * which this feature does not own. The pack's `<link rel="manifest">` is deliberately
 * absent: `nuxt4:pwa` generates and injects its own manifest, and two would collide.
 */
async function wireIcons(ctx: RunContext): Promise<void> {
    await patchNuxtConfig(ctx.projectDir, (c) => {
        // Order follows the pack: `.ico` first for the browsers that take the first
        // entry they recognise, SVG next for those that read `type`.
        c.addHeadLink({ rel: 'icon', sizes: '32x32', href: '/favicon.ico' })
        c.addHeadLink({ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' })
        c.addHeadLink({ rel: 'apple-touch-icon', href: '/apple-touch-icon.png' })
        c.addHeadMeta({ name: 'theme-color', content: BRAND_NAVY })
    })
}
