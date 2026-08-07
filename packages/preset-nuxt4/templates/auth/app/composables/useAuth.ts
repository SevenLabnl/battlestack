export interface MfaRequired {
    requiresMfa: true
    mfaToken: string
}

type LoginResult = MfaRequired | { ok: true }

export function useAuth() {
    const { loggedIn, user, clear, fetch: refresh } = useUserSession()

    async function login(email: string, password: string): Promise<LoginResult> {
        const res = await $fetch<LoginResult>('/api/auth/login', {
            method: 'POST',
            body: { email, password },
        })
        if (!('requiresMfa' in res)) await refresh()
        return res
    }

    async function completeMfaChallenge(mfaToken: string, code: string) {
        await $fetch('/api/auth/2fa/challenge', {
            method: 'POST',
            body: { mfaToken, code },
        })
        await refresh()
    }

    async function signup(email: string, password: string): Promise<{ ok: true }> {
        const res = await $fetch<{ ok: true }>('/api/auth/signup', {
            method: 'POST',
            body: { email, password },
        })
        await refresh()
        return res
    }

    async function logout() {
        await $fetch('/api/auth/logout', { method: 'POST' })
        await clear()
        // Auth middleware only runs on route change, so `clear()` alone leaves the user on the current page in an unauthed state.
        // Redirect to /login to match the "sign out" mental model.
        await navigateTo('/login')
    }

    return {
        loggedIn,
        user,
        login,
        signup,
        logout,
        completeMfaChallenge,
        fetchUser: refresh,
    }
}
