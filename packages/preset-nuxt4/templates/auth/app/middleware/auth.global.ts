const PUBLIC_ROUTES = [
    '/login',
    '/signup',
    '/forgot-password',
    '/reset-password',
    '/verify-email',
    // Dev-only magic-link landing: `battlestack login` / `battlestack uli` opens this.
    // Server endpoint enforces the dev-build + localhost guards; the page just dispatches.
    '/auth/magic-login',
]

export default defineNuxtRouteMiddleware(async (to) => {
    const nuxtApp = useNuxtApp()
    if (import.meta.client && nuxtApp.isHydrating && nuxtApp.payload.serverRendered) return

    if (PUBLIC_ROUTES.includes(to.path)) return

    const { loggedIn } = useUserSession()
    if (!loggedIn.value) return navigateTo('/login')
})
