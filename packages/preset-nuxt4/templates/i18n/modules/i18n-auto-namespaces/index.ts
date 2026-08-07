import { createResolver, defineNuxtModule } from 'nuxt/kit'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

/** Auto-registers `i18n/locales/<code>/*.json` via the `i18n:registerModule` hook. */
export default defineNuxtModule({
    meta: { name: 'i18n-auto-namespaces' },
    setup(_options, nuxt) {
        const resolver = createResolver(nuxt.options.rootDir)
        const langDir = resolver.resolve('i18n/locales')
        if (!existsSync(langDir)) return

        // `i18n:registerModule` registration is ordering-safe but not wired into @nuxtjs/i18n's Vite HMR, so editing a namespace
        // JSON in dev shows stale/raw keys until restart; watch the dir to restart the server and re-register on change.
        if (nuxt.options.dev) {
            ;(nuxt.options.watch ??= []).push(resolve(langDir, '**', '*.json'))
        }

        nuxt.hook(
            'i18n:registerModule',
            (
                register: (options: {
                    langDir: string
                    locales: Array<{ code: string; file: string }>
                }) => void,
            ) => {
                const locales: Array<{ code: string; file: string }> = []
                for (const code of readdirSync(langDir)) {
                    const dir = resolve(langDir, code)
                    if (!statSync(dir).isDirectory()) continue
                    for (const f of readdirSync(dir)) {
                        if (f.endsWith('.json')) locales.push({ code, file: `${code}/${f}` })
                    }
                }
                if (locales.length === 0) return
                register({ langDir, locales })
            },
        )
    },
})
