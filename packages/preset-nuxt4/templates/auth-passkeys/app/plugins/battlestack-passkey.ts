// Exposes `usePasskey()` to login.vue without that page needing to know whether `nuxt:auth-passkeys` is installed at build time.
// login.vue reads `useNuxtApp().$battlestackPasskey`: undefined when absent, a factory function when present.
export default defineNuxtPlugin(() => ({
    provide: {
        battlestackPasskey: () => usePasskey(),
    },
}))
