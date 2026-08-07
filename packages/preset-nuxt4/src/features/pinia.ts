import { STAGE, type Feature } from '@battlestack/core'
import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'

/** Pinia + persistedstate Nuxt modules. */
export const piniaFeature: Feature = {
    id: 'nuxt4:pinia',
    version: '1.0.0',
    label: 'Pinia + persisted-state',
    frameworks: ['nuxt4'],
    stage: STAGE.BASE_CONFIG,
    failureIsNonFatal: true,

    collectModules() {
        return ['@pinia/nuxt', 'pinia-plugin-persistedstate/nuxt']
    },

    collectDeps() {
        return { prod: ['pinia', '@pinia/nuxt', 'pinia-plugin-persistedstate'] }
    },

    collectDocs() {
        return [
            {
                heading: 'State (Pinia)',
                body: [
                    '`@pinia/nuxt` + `pinia-plugin-persistedstate/nuxt` are pre-wired. Use `useUiStore()` from `app/stores/ui.ts` as the worked example. Stores opt into cookie-backed persistence with `persist: true` on the store definition; cookies are the Nuxt module default so SSR renders match the client without a flash. Remove the `persist` line for non-persisted state.',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute(ctx) {
        await emitTemplate(ctx, 'nuxt4:pinia', import.meta.url, 'pinia')
    },

    async update(ctx, prev) {
        return emitTemplateUpdate(ctx, 'nuxt4:pinia', import.meta.url, 'pinia', prev)
    },
}
