import { _api } from '@iconify/vue'

/**
 * Restores SSR icon loading under Nuxt 4.5 / Nitro 2.13, where `useRequestFetch().native` is
 * `undefined` on the server: `@nuxt/icon`'s own plugin passes that to `_api.setFetch()`, leaving
 * iconify with no fetch at all. Every server-rendered icon then aborts with
 * `WARN [Icon] failed to load icon ...` and the SSR HTML ships without the SVGs (icons only pop
 * in after client hydration). h3's `event.fetch` resolves the relative `/api/_nuxt_icon/...`
 * URL in-process and returns a real `Response`, which is exactly what iconify expects.
 * Remove once @nuxt/icon handles the missing `.native` itself (fine to keep: it no-ops then).
 */
export default defineNuxtPlugin({
    name: 'icon-ssr-fetch',
    dependsOn: ['@nuxt/icon'],
    setup() {
        const event = useRequestEvent()
        // `useRequestFetch()` returns a union whose server-side member has no `.native` in its
        // type (nor at runtime, which is the whole bug), so probe it structurally.
        const requestFetch = useRequestFetch() as unknown as { native?: unknown }
        if (!event || typeof requestFetch.native === 'function') return
        // Iconify only ever passes string URLs; `event.fetch` declares a narrower request type.
        _api.setFetch(((input: string | URL | Request, init?: RequestInit) =>
            event.fetch(input as string, init)) as typeof fetch)
    },
})
