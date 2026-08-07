// In `shared/types` so both TS programs `nuxi typecheck` runs see it, and callers typecheck whether or not the optional listener is installed.
// Augment `nitropack/types` specifically: that is where `useNitroApp().hooks` resolves `NitroRuntimeHooks` from.
export {}

declare module 'nitropack/types' {
    interface NitroRuntimeHooks {
        /**
         * Fired after a new user row is created via self-service signup.
         * `nuxt:auth-verification` listens to issue the verification email.
         */
        'auth:user-registered': (user: {
            id: string
            email: string
            locale: string | null
        }) => void | Promise<void>
    }
}
