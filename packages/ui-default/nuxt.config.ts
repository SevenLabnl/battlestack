import { createResolver } from '@nuxt/kit'

const { resolve } = createResolver(import.meta.url)

// @sevenlab/ui-default — the Battlestack theme. Values only: token definitions
// for light and dark, plus the Nuxt UI bridge. A client theme extends this layer
// and overrides values; it never redefines a token name.
export default defineNuxtConfig({
    extends: ['@sevenlab/ui'],

    // Brand lives in the theme layer, never in @sevenlab/ui. A client theme
    // extending this one can ship a BrandLockup.vue of its own and it wins.
    components: [{
        path: resolve('./components'),
        prefix: 'Bs',
        pathPrefix: false,
        global: false,
    }],

    css: [resolve('./styles/index.css')],

    // Self-hosted at build time by @nuxt/fonts. The export loads these from the
    // Google Fonts CDN, which the boilerplate's CSP blocks — see
    // tokens/typography.css for the full reasoning.
    fonts: {
        families: [
            { name: 'Plus Jakarta Sans', provider: 'google', weights: [400, 500, 600, 700, 800] },
            { name: 'JetBrains Mono', provider: 'google', weights: [400, 500, 600] },
        ],
    },
})
