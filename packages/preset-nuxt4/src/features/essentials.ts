import path from 'node:path'
import { readJson, writeJson, STAGE, type Feature, type RunContext } from '@battlestack/core'
import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'

/** Always-on Nuxt essentials: `@nuxt/eslint`, `@nuxt/fonts`, `@nuxt/image`, datepicker, `@iconify/vue`. */
export const essentialsFeature: Feature = {
    id: 'nuxt4:essentials',
    version: '1.0.4',
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
        ]
    },

    async execute(ctx) {
        await emitTemplate(ctx, 'nuxt4:essentials', import.meta.url, 'essentials')
        await wireScripts(ctx)
    },

    async update(ctx, prev) {
        const report = await emitTemplateUpdate(ctx, 'nuxt4:essentials', import.meta.url, 'essentials', prev)
        await wireScripts(ctx)
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
