/** Passkey (WebAuthn) registration and authentication. */
export function usePasskey() {
    const { register, authenticate } = useWebAuthn({
        registerEndpoint: '/api/auth/passkey/register',
        authenticateEndpoint: '/api/auth/passkey/authenticate',
    })

    return {
        async signUp(email: string, displayName: string) {
            return register({ userName: email, displayName })
        },
        async signIn(email: string) {
            return authenticate(email)
        },
        async addCredential(email: string, displayName: string) {
            return register({ userName: email, displayName })
        },
    }
}
