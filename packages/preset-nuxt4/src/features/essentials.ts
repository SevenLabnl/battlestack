import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { ui } from '@battlestack/tui'
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
    version: '1.2.4',
    label: 'Nuxt essentials (eslint, fonts, image, iconify, datepicker, nodemailer)',
    frameworks: ['nuxt4'],
    stage: STAGE.BASE_CONFIG,

    collectModules() {
        return ['@nuxt/eslint', '@nuxt/fonts', '@nuxt/image']
    },

    collectDeps() {
        return {
            prod: ['@vuepic/vue-datepicker', '@iconify/vue', 'h3@^1'],
            // `@iconify-json/lucide` is a local icon bundle. eslint/typescript/vue-tsc are explicit.
            // TypeScript stays on 6 until vue-tsc and typescript-eslint support the TS 7 API.
            dev: ['@iconify-json/lucide', 'eslint', 'typescript@^6', 'vue-tsc'],
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
                    'These three paths are **user-owned**: once they exist, `battlestack pull` never touches them. Replace them with the client\'s own branding and the update path will leave your version alone. Keep the filenames: the `<link>` tags in `nuxt.config.ts` point at them. A project scaffolded before the icon pack shipped gets them written once, on the pull that introduces them, and they are user-owned from then on.',
                    '',
                    'A project that declares its own icon links gets none of the template\'s, because browsers use the last matching icon and the template links would override yours. `pull` looks for `icon`, `shortcut icon` or `apple-touch-icon` links in `nuxt.config.ts#app.head.link`, `app/app.vue` and `app/layouts/`. Icon links set anywhere else, such as a page, a plugin or `app/error.vue`, are not detected: move them to one of those places, or `pull` adds the template links next to them.',
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
        const note = await wireIcons(ctx)
        if (note) ui.dim(note)
    },

    async update(ctx, prev) {
        const report = await emitTemplateUpdate(ctx, 'nuxt4:essentials', import.meta.url, 'essentials', prev)
        await wireScripts(ctx)
        const note = await wireIcons(ctx)
        if (note) report.notes.push(note)
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

const ICON_RELS = new Set(['icon', 'apple-touch-icon'])

/** True for `icon`, `shortcut icon`, `Icon`, `apple-touch-icon` and the like. */
function isIconRel(rel: unknown): boolean {
    if (typeof rel !== 'string') return false
    return rel.toLowerCase().split(/\s+/).some((token) => ICON_RELS.has(token))
}

/** Matches `rel: 'icon'` (a `useHead` link), `rel="icon"`, `rel=icon` and `:rel="'icon'"` (a `<link>` in a template). */
const REL_IN_SOURCE = /\brel\s*[:=]\s*(?:(['"`])(.*?)\1|([^\s>'"`]+))/g

function relValue(match: RegExpMatchArray): string {
    return (match[2] ?? match[3] ?? '').replace(/['"`]/g, '')
}

/**
 * Whether `app/app.vue` or a layout under `app/layouts/` declares an icon link. A plain
 * text scan: battlestack never writes icon links into Vue files, so any match is the project's.
 */
async function vueSourcesDeclareIcon(projectDir: string): Promise<boolean> {
    const appDir = path.join(projectDir, 'app')
    const files = [path.join(appDir, 'app.vue')]
    try {
        const entries = await readdir(path.join(appDir, 'layouts'), { recursive: true, withFileTypes: true })
        for (const e of entries) {
            if (e.isFile() && e.name.endsWith('.vue')) files.push(path.join(e.parentPath, e.name))
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    for (const file of files) {
        let source: string
        try {
            source = await readFile(file, 'utf8')
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
            throw error
        }
        for (const m of source.matchAll(REL_IN_SOURCE)) {
            if (isIconRel(relValue(m))) return true
        }
    }
    return false
}

/**
 * Points the document head at our icon set, mirroring `icon-pack/head.html` from the
 * battlestack icon pack, and sets `theme-color`. `nuxi init` only leaves a bare
 * `public/favicon.ico`, so without these links the SVG and the iOS icon go unused.
 *
 * A project with its own icon links gets none of ours, since browsers take the last
 * matching icon and ours would override its branding. Detected: an icon or
 * apple-touch-icon link (any rel casing, `shortcut icon` included) in `nuxt.config.ts`
 * `app.head.link` whose href is not one of ours, or in `app/app.vue` or `app/layouts/`.
 * Pages, plugins and `error.vue` are not scanned. Returns a note when the links are skipped.
 *
 * Lives in `nuxt.config.ts` (plain data, serializes fine) rather than `app/app.vue`,
 * which this feature does not own. The pack's `<link rel="manifest">` is deliberately
 * absent: `nuxt4:pwa` generates and injects its own manifest, and two would collide.
 */
async function wireIcons(ctx: RunContext): Promise<string | undefined> {
    const iconsInVue = await vueSourcesDeclareIcon(ctx.projectDir)
    let skipped = iconsInVue
    let removedOurs = false
    await patchNuxtConfig(ctx.projectDir, (c) => {
        const icons: Record<string, string>[] = [
            // Order follows the pack: `.ico` first for the browsers that take the first
            // entry they recognise, SVG next for those that read `type`.
            { rel: 'icon', sizes: '32x32', href: '/favicon.ico' },
            { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
            { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
        ]
        const brandedInConfig = c.headLinks().some(
            (l) => isIconRel(l.rel) && !icons.some((i) => i.href === l.href),
        )
        skipped ||= brandedInConfig
        if (!skipped) for (const icon of icons) c.addHeadLink(icon)
        else {
            // All three present is what an earlier pull leaves; one alone may be the project's own.
            const same = (a: Record<string, string>, b: Record<string, string>): boolean => a.rel === b.rel && a.href === b.href
            if (icons.every((i) => c.headLinks().some((l) => same(l, i)))) {
                removedOurs = c.removeHeadLinks((l) => icons.some((i) => same(l, i))) > 0
            }
        }
        c.addHeadMeta({ name: 'theme-color', content: BRAND_NAVY })
    })
    if (!skipped) return undefined
    const where = iconsInVue ? 'app/app.vue or app/layouts/' : 'nuxt.config.ts app.head.link'
    return `own icon links found in ${where}, so the template favicon links were ${removedOurs ? 'removed' : 'not added'}`
}
