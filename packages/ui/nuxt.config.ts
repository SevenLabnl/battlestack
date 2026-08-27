import { createResolver } from '@nuxt/kit'

const { resolve } = createResolver(import.meta.url)

// @sevenlab/ui — the component layer. Carries structure, behaviour and states.
// It defines no values: every colour, size and radius resolves through a theme
// layer (@sevenlab/ui-default, or a client theme extending it).
export default defineNuxtConfig({
    // `pathPrefix: false` keeps the group folders out of the name, so
    // `components/actions/Button.vue` registers as `<BsButton>`, not `<BsActionsButton>`.
    // `global: false` keeps components tree-shakeable.
    components: [{
        path: resolve('./components'),
        prefix: 'Bs',
        pathPrefix: false,
        global: false,
    }],

    css: [resolve('./styles/index.css')],
})
