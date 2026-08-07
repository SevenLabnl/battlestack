import { STAGE, type Feature } from '@battlestack/core'
import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'
import { patchNuxtConfig } from '../utils/nuxt-config.js'

/** Progressive Web App via `@vite-pwa/nuxt`. Ships placeholder 192/512 icons; replace before launch. */
export const pwaFeature: Feature = {
    id: 'nuxt4:pwa',
    version: '1.0.2',
    label: 'Progressive Web App',
    description: 'Offline-capable installable app via @vite-pwa/nuxt.',
    frameworks: ['nuxt4'],
    stage: STAGE.PWA,
    failureIsNonFatal: true,

    collectModules() {
        return ['@vite-pwa/nuxt']
    },

    collectDocs() {
        return [
            {
                heading: 'PWA',
                body: [
                    'Service-worker via `@vite-pwa/nuxt` with `autoUpdate` registration. Manifest is wired in `nuxt.config.ts#pwa`; icons live at `public/icon-192.png` + `public/icon-512.png`.',
                    '',
                    'Replace both icons with your own branding before launch. The shipped PNGs are placeholder solid-colour fills.',
                    '',
                    'Service-worker is **disabled in dev** (`devOptions.enabled: false`) so HMR + auto-reload behave normally. Flip to `true` only when you specifically want to debug SW behaviour locally.',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute(ctx) {
        await emitTemplate(ctx, 'nuxt4:pwa', import.meta.url, 'pwa')
        await registerPwaConfig(ctx.projectDir, ctx.projectName)
    },

    async update(ctx, prev) {
        const result = await emitTemplateUpdate(ctx, 'nuxt4:pwa', import.meta.url, 'pwa', prev)
        await registerPwaConfig(ctx.projectDir, ctx.projectName)
        return result
    },
}

async function registerPwaConfig(projectDir: string, projectName: string): Promise<void> {
    await patchNuxtConfig(projectDir, (c) =>
        c.mutate((cfg) => {
            cfg.pwa ??= {
                registerType: 'autoUpdate',
                manifest: {
                    name: projectName,
                    short_name: projectName,
                    theme_color: '#3b82f6',
                    background_color: '#ffffff',
                    display: 'standalone',
                    icons: [
                        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
                        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
                        {
                            src: '/icon-512.png',
                            sizes: '512x512',
                            type: 'image/png',
                            purpose: 'maskable',
                        },
                    ],
                },
                workbox: {
                    navigateFallback: '/',
                    globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
                },
            }
            // Set unconditionally, unlike the `??=` above. Off in dev, so the SW leaves HMR alone.
            const pwa = cfg.pwa as Record<string, unknown>
            pwa.devOptions ??= { enabled: false }
        }),
    )
}
