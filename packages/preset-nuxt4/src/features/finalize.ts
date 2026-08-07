import { writeManifest, STAGE, type Feature } from '@battlestack/core'

export const finalizeFeature: Feature = {
    id: 'nuxt4:finalize',
    version: '1.0.0',
    label: 'Write project manifest',
    frameworks: ['nuxt4'],
    stage: STAGE.FINALIZE,
    upgradable: false,

    async execute(ctx) {
        await writeManifest(ctx)
    },
}
