/** Route-level admin gate. Use via `definePageMeta({ middleware: 'admin' })`. */
export default defineNuxtRouteMiddleware((to) => {
    const { user } = useUserSession()
    const role = (user.value as { role?: string } | null)?.role
    if (role === 'admin') return

    if (to.path === '/dashboard') {
        throw createError({
            statusCode: 403,
            statusMessage: 'Admin access required',
        })
    }
    return navigateTo('/dashboard')
})
