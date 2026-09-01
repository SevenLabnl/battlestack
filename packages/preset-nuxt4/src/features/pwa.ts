import { STAGE, type Feature } from '@battlestack/core'
import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'
import { patchNuxtConfig } from '../utils/nuxt-config.js'

/** Navy plate from the battlestack icon pack. Matches `nuxt4:essentials`' `theme-color` meta. */
const BRAND_THEME_COLOR = '#0D1520'
const BRAND_BACKGROUND_COLOR = '#0A121E'

/** Values shipped before the icon pack. A manifest still holding one has not been rebranded. */
const LEGACY_THEME_COLOR = '#3b82f6'
const LEGACY_BACKGROUND_COLOR = '#ffffff'

const MASKABLE_ICONS = [
    { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
] as const

/** Plain icon a pre-icon-pack manifest reused as its maskable entry, mapped to the real one. */
const DEDICATED_MASKABLE: Record<string, string> = {
    '/icon-192.png': '/icon-maskable-192.png',
    '/icon-512.png': '/icon-maskable-512.png',
}

/** Progressive Web App via `@vite-pwa/nuxt`. Ships the battlestack icon pack; rebrand before launch. */
export const pwaFeature: Feature = {
    id: 'nuxt4:pwa',
    version: '1.1.0',
    label: 'Progressive Web App',
    description: 'Offline-capable installable app via @vite-pwa/nuxt.',
    frameworks: ['nuxt4'],
    stage: STAGE.PWA,
    // The manifest names `/favicon.svg`, which `nuxt4:essentials` emits and owns. Declared so a
    // feature set that enables pwa without it cannot ship a manifest pointing at a missing file.
    requires: ['nuxt4:essentials'],
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
        result.notes.push(...await registerPwaConfig(ctx.projectDir, ctx.projectName))
        return result
    },
}

async function registerPwaConfig(
    projectDir: string,
    projectName: string,
): Promise<string[]> {
    const notes: string[] = []
    await patchNuxtConfig(projectDir, (c) =>
        c.mutate((cfg) => {
            if (cfg.pwa === undefined) {
                cfg.pwa = {
                    registerType: 'autoUpdate',
                    manifest: {
                        name: projectName,
                        short_name: projectName,
                        // From the battlestack icon pack's `site.webmanifest`. `theme_color`
                        // matches the `theme-color` meta that `nuxt4:essentials` emits.
                        theme_color: BRAND_THEME_COLOR,
                        background_color: BRAND_BACKGROUND_COLOR,
                        display: 'standalone',
                        icons: [
                            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
                            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
                            ...MASKABLE_ICONS,
                            { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
                        ],
                    },
                    workbox: {
                        navigateFallback: '/',
                        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
                    },
                }
            } else {
                repairManifest(cfg.pwa, notes)
            }
            // Set unconditionally, unlike the branch above. Off in dev, so the SW leaves HMR alone.
            const pwa = cfg.pwa as Record<string, unknown>
            pwa.devOptions ??= { enabled: false }
        }),
    )
    return notes
}

/**
 * Brings a manifest written by an earlier version up to date in place.
 *
 * A whole-object `??=` cannot do this: the key already exists on any project that ran an earlier
 * version, so every corrected value would be skipped while `emitTemplateUpdate` still writes the
 * new icon files, leaving the manifest pointing at the old ones.
 *
 * Only values still holding an earlier default are touched, so a project that rebranded keeps its
 * own. Entries are edited and appended rather than the array being replaced, because a magicast
 * proxy loses any key this function does not know about when reassigned wholesale.
 */
function repairManifest(pwa: unknown, notes: string[]): void {
    const manifest = (pwa as { manifest?: Record<string, unknown> }).manifest
    if (!manifest) return

    const icons = manifest.icons as Record<string, unknown>[] | undefined
    if (icons) {
        // `[...icons]` is load-bearing: array methods on a magicast proxy scan the AST node
        // rather than the elements. See `addHeadLink` in `utils/nuxt-config.ts`.
        for (const icon of [...icons]) {
            if (icon.purpose !== 'maskable') continue
            const dedicated = DEDICATED_MASKABLE[String(icon.src ?? '')]
            if (!dedicated) continue
            icon.src = dedicated
            notes.push(`pwa: maskable icon now points at ${dedicated} instead of a plain icon, which Android crops`)
        }
        const present = new Set([...icons].map((icon) => String(icon.src ?? '')))
        for (const wanted of MASKABLE_ICONS) {
            if (present.has(wanted.src)) continue
            icons.push(wanted)
            notes.push(`pwa: added the missing ${wanted.src} manifest entry`)
        }
    }

    if (manifest.theme_color === LEGACY_THEME_COLOR) {
        manifest.theme_color = BRAND_THEME_COLOR
        notes.push(`pwa: theme_color updated to ${BRAND_THEME_COLOR}`)
    }
    if (manifest.background_color === LEGACY_BACKGROUND_COLOR) {
        manifest.background_color = BRAND_BACKGROUND_COLOR
        notes.push(`pwa: background_color updated to ${BRAND_BACKGROUND_COLOR}`)
    }
}
