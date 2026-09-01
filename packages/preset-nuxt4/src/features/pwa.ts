import { STAGE, type Feature } from '@battlestack/core'
import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'
import { patchNuxtConfig } from '../utils/nuxt-config.js'

/** Progressive Web App via `@vite-pwa/nuxt`. Ships the battlestack icon pack; rebrand before launch. */
export const pwaFeature: Feature = {
    id: 'nuxt4:pwa',
    version: '1.1.0',
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
                    'Service-worker via `@vite-pwa/nuxt` with `autoUpdate` registration. Manifest is wired in `nuxt.config.ts#pwa` — `@vite-pwa` generates and injects it, so do **not** add a second `public/site.webmanifest`. Icons live at `public/icon-{192,512}.png` plus `public/icon-maskable-{192,512}.png`.',
                    '',
                    'The shipped icons are the battlestack rook. Replace all four with your own branding before launch. The maskable pair is a separate drawing with a 66% safe zone: Android crops it to whatever shape the launcher uses, so it is full-bleed on purpose and must not simply be a copy of the plain icon.',
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
                    // From the battlestack icon pack's `site.webmanifest`. `theme_color`
                    // matches the `theme-color` meta that `nuxt4:essentials` emits.
                    theme_color: '#0D1520',
                    background_color: '#0A121E',
                    display: 'standalone',
                    icons: [
                        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
                        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
                        {
                            src: '/icon-maskable-192.png',
                            sizes: '192x192',
                            type: 'image/png',
                            purpose: 'maskable',
                        },
                        {
                            src: '/icon-maskable-512.png',
                            sizes: '512x512',
                            type: 'image/png',
                            purpose: 'maskable',
                        },
                        { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
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
