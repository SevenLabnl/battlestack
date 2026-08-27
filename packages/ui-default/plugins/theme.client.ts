/**
 * Keeps the design system's dark selector in sync with the app's colour mode.
 *
 * The design system switches on `[data-theme="dark"]`; Nuxt UI and
 * @nuxtjs/color-mode switch on a `.dark` class on <html>. Without this mirror
 * half the page renders in the wrong theme.
 *
 * Watching the class list rather than calling `useColorMode()` keeps the layer
 * usable without the colour-mode module, and works with any switcher that
 * follows the same convention.
 *
 * Known gap (closes in M1): this runs after hydration, so a server-rendered
 * dark page shows light token values until the first mirror. Fixing it properly
 * means binding `data-theme` through `useHead` from the colour-mode state so it
 * ships in the SSR markup.
 */
export default defineNuxtPlugin(() => {
    const root = document.documentElement

    const sync = () => {
        root.dataset.theme = root.classList.contains('dark') ? 'dark' : 'light'
    }

    sync()

    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })

    // Nuxt tears plugins down on HMR and on full page teardown in tests.
    return { provide: {} }
})
