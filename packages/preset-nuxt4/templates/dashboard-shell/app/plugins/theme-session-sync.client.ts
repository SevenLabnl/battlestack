/**
 * Makes the theme on the user's row (set via `/dashboard/profile`) the authority over the browser's
 * local colour-mode state. The theme counterpart to `i18n-session-sync.client.ts`.
 */
const THEMES = ['light', 'dark', 'system'] as const
type Theme = (typeof THEMES)[number]

export default defineNuxtPlugin((nuxtApp) => {
    const { user } = useUserSession()
    const colorMode = useColorMode()

    function applyProfileTheme() {
        const next = (user.value as { theme?: string | null } | null)?.theme
        if (!next || !THEMES.includes(next as Theme)) return
        if (colorMode.preference === next) return
        colorMode.preference = next
    }

    // `app:mounted`, not plugin init: `@nuxtjs/color-mode` restores its own preference from
    // localStorage during hydration and would clobber an earlier write, so the profile said dark
    // and the app still came up light. Applying after that restore is what makes this stick.
    nuxtApp.hook('app:mounted', applyProfileTheme)

    // Later session changes (signing in as someone else, saving the profile) re-apply.
    watch(() => (user.value as { theme?: string | null } | null)?.theme, applyProfileTheme)
})
