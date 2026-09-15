import { createResolver } from '@nuxt/kit'

const { resolve } = createResolver(import.meta.url)

// @battlestack/theme — the Battlestack Design System as a Nuxt layer.
//
// This layer deliberately contains no component library: Nuxt UI is the
// component library, and this package only themes it. What it ships:
//
//   - `tokens.css`  — Tailwind `@theme` ramps + `--ui-*` values for light/dark.
//     NOT loaded here: `@theme` must be compiled inside the project's own
//     Tailwind root, so `nuxt4:battlestack-theme` imports it from the project's
//     `app/assets/css/main.css`, after `@import "@nuxt/ui"`.
//   - the brand Logo lockup (`<BsLogo>`) and the SVG assets it mirrors.
//   - the design-system gates (`check:contrast`, `check:contract`).
//
// A client theme extends this layer (or simply overrides values in the
// project's `brand.css`); it re-values tokens, it never adds a component.
export default defineNuxtConfig({
    // Brand lives in the theme, never in app code. A client theme extending
    // this layer can ship its own `components/Logo.vue` and it wins.
    components: [{
        path: resolve('./components'),
        prefix: 'Bs',
        pathPrefix: false,
        global: false,
    }],

    // Self-hosted at build time by `@nuxt/fonts` (always on via
    // `nuxt4:essentials`). The design export loads these from the Google Fonts
    // CDN, which the boilerplate's CSP blocks — naming them here keeps
    // `--font-sans`/`--font-mono` in `tokens.css` purely declarative.
    fonts: {
        families: [
            { name: 'Plus Jakarta Sans', provider: 'google', weights: [400, 500, 600, 700, 800] },
            { name: 'JetBrains Mono', provider: 'google', weights: [400, 500, 600] },
        ],
    },
})
