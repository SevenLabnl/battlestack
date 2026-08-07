import { STAGE, type Feature, type RunContext } from '@battlestack/core'
import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'
import { patchNuxtConfig } from '../utils/nuxt-config.js'

/** Nuxt UI v4 + Tailwind v4. Registers `@nuxt/ui` module and wires `assets/css/main.css`. */
export const nuxtUiFeature: Feature = {
    id: 'nuxt4:nuxt-ui',
    version: '1.2.0',
    label: 'Nuxt UI v4 + Tailwind v4',
    frameworks: ['nuxt4'],
    stage: STAGE.STYLING,

    collectModules() {
        return ['@nuxt/ui']
    },

    collectDocs() {
        return [
            {
                heading: 'Nuxt UI design tokens',
                body: [
                    'Component color aliases (`primary`, `secondary`, `neutral`, etc.) live in `app/app.config.ts` under `ui.colors`. This is the runtime-overridable variant: change a value and every component using that alias updates without rebuild.',
                    '',
                    'Tailwind utilities + design CSS variables come from `app/assets/css/main.css` (`@import "tailwindcss"` + `@import "@nuxt/ui"`). Custom Tailwind tokens go above the `@nuxt/ui` import so they win precedence.',
                    '',
                    'Root layout wraps `<UApp>` in `app/app.vue`, which is required for `useToast()`, `<UTooltip>`, and other components that need a portal target.',
                    '',
                    'Document title: `app/app.vue` defines a `titleTemplate` that renders `"<page title> - <app name>"`. Set a per-page title with `useHead({ title: () => t(\'...\') })` (function form keeps it reactive on locale switch); pages without a title fall back to just the app name. The app name comes from `runtimeConfig.public.appName` (defaults to the project name; override with `NUXT_PUBLIC_APP_NAME` or in `nuxt.config.ts`).',
                    '',
                    'Datepicker stays on `@vuepic/vue-datepicker` (`nuxt4:essentials`): the Nuxt UI `<UCalendar>` keyboard semantics + locale support are too thin for our forms.',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute(ctx) {
        await emitTemplate(ctx, 'nuxt4:nuxt-ui', import.meta.url, 'nuxt-ui')
        await configureNuxtConfig(ctx)
    },

    async update(ctx, prev) {
        const result = await emitTemplateUpdate(ctx, 'nuxt4:nuxt-ui', import.meta.url, 'nuxt-ui', prev)
        await configureNuxtConfig(ctx)
        return result
    },
}

async function configureNuxtConfig(ctx: RunContext): Promise<void> {
    await patchNuxtConfig(ctx.projectDir, (c) => {
        c.addCss('~/assets/css/main.css')
        // Seeds the app name, writing only when absent.
        c.setRuntimePublicDefault('appName', ctx.projectName)
    })
}
