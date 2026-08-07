import type { Composer } from 'vue-i18n'

/**
 * Syncs the user's preferred locale (set via /api/auth/profile) into vue-i18n's active locale on every session change.
 * Plugins run outside a Vue setup scope, so `useI18n()` isn't available here; read the Composer via `nuxtApp.$i18n` instead.
 */
export default defineNuxtPlugin((nuxtApp) => {
    const { user } = useUserSession()
    const i18n = nuxtApp.$i18n as Composer

    const apply = async (next: string | null | undefined): Promise<void> => {
        if (!next) return
        if (next === i18n.locale.value) return
        const known = (i18n.locales.value as Array<{ code: string }>).some((l) => l.code === next)
        if (!known) return
        await nuxtApp.runWithContext(() => i18n.setLocale(next as 'en' | 'nl'))
    }

    watch(
        () => (user.value as { locale?: string | null } | null)?.locale,
        (next) => {
            void apply(next)
        },
        { immediate: true },
    )
})
