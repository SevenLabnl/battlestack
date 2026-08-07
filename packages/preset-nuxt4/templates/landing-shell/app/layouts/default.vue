<template>
    <div class="min-h-screen">
        <UHeader>
            <template #left>
                <!-- `/`, not `/dashboard`: this feature emits `app/pages/index.vue`, so `/` always exists while `/dashboard` only exists
                     when `nuxt4:dashboard-shell` is installed; also avoids the brand and first nav item pointing at the same destination. -->
                <UButton variant="ghost" to="/" class="font-bold text-lg">
                    {{ appName }}
                </UButton>
            </template>

            <UNavigationMenu :items="nav" />

            <template #right>
                <!-- `v-if`: an empty `topbar` still renders a real <nav>, so `#right`'s
                     `gap-1.5` gap gets spent on an element that draws nothing. -->
                <UNavigationMenu v-if="topbar.length > 0" :items="topbar" />
                <!-- battlestack:auth -->
                <UDropdownMenu v-if="showAvatar" :items="avatarMenu">
                    <button
                        type="button"
                        :aria-label="t('shell.accountMenu')"
                        class="flex items-center justify-center w-9 h-9 rounded-full bg-primary-500 text-white text-sm font-semibold overflow-hidden focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                    >
                        <!-- Decorative: the button already carries the accessible name via `aria-label`. `users.name` is nullable, so binding
                             `:alt` to it could leave the control with an empty accessible name for exactly the users who uploaded an avatar. -->
                        <img
                            v-if="avatarUrl"
                            :src="avatarUrl"
                            alt=""
                            class="h-full w-full object-cover"
                        />
                        <span v-else>{{ userInitial }}</span>
                    </button>
                </UDropdownMenu>
                <!-- /battlestack:auth -->
            </template>

            <template #body>
                <UNavigationMenu :items="nav" orientation="vertical" class="-mx-2.5" />
            </template>
        </UHeader>

        <UMain class="p-4 sm:p-6">
            <UContainer>
                <slot />
            </UContainer>
        </UMain>
    </div>
</template>

<script setup lang="ts">
const config = useAppConfig()
const runtimeConfig = useRuntimeConfig()
const { t } = useI18n()
const topbar = computed(() => config.topbar ?? [])
// Read from `runtimeConfig.public.appName`, not `useAppConfig()`: the scaffolder writes the project name to the former
// (`features/nuxt-ui.ts`); reading from `useAppConfig()` fell through to the literal fallback, showing "App" in the header.
const appName = computed(
    () => (runtimeConfig.public.appName as string | undefined) || 'App',
)

// battlestack:auth
const session = useUserSession()
const showAvatar = computed(() => !!session.loggedIn.value)
const userInitial = computed(() => {
    const name = session.user.value?.name ?? session.user.value?.email ?? '?'
    return String(name).charAt(0).toUpperCase()
})

// Shared with `dashboard/profile.vue` via the `battlestack-avatar-url` useState key; upload/delete writes it, we read it here.
// Endpoint exists only when `nuxt:storage` is installed; failure is silent.
const avatarUrl = useState<string | null>('battlestack-avatar-url', () => null)
onMounted(async () => {
    if (!session.loggedIn.value) return
    if (avatarUrl.value) return
    try {
        const r = await $fetch<{ avatarUrl: string | null }>('/api/auth/avatar')
        avatarUrl.value = r.avatarUrl
    } catch {
        // no storage feature installed or no avatar yet
    }
})

const isAdmin = computed(
    () => (session.user.value as { role?: string } | null | undefined)?.role === 'admin',
)

const { logout } = useAuth()
async function onSignOut() {
    await logout()
}

const avatarMenu = computed(() => [
    [
        { label: t('shell.profile'), to: '/dashboard/profile', icon: 'i-lucide-user' },
        { label: t('shell.security'), to: '/dashboard/security', icon: 'i-lucide-shield' },
    ],
    [
        { label: t('shell.signOut'), onSelect: onSignOut, icon: 'i-lucide-log-out' },
    ],
])
// /battlestack:auth
const publicFlags = computed(
    () =>
        runtimeConfig.public as {
            dashboard?: boolean
            userAdmin?: boolean
            mastraAdmin?: boolean
            promptMgmt?: boolean
            chat?: boolean
            rag?: boolean
        },
)

const nav = computed(() => {
    const base = [...((config.nav ?? []) as Array<Record<string, unknown>>)]

    // Gated, not hardcoded in `app.config.ts`: `nuxt4:landing-shell` is default-on in `nuxt4-minimal`, which never installs
    // `nuxt4:dashboard-shell`; a static entry advertised a route the scaffold never emits, so the whole bar 404'd.
    if (publicFlags.value.dashboard) {
        base.push({
            label: t('shell.dashboard'),
            to: '/dashboard',
            icon: 'i-lucide-layout-dashboard',
        })
    }

    if (publicFlags.value.chat) {
        base.push({
            label: t('shell.chat'),
            to: '/chat',
            icon: 'i-lucide-message-circle',
        })
    }

    if (!isAdmin.value) return base

    const children: Array<Record<string, unknown>> = []
    if (publicFlags.value.userAdmin) {
        children.push({
            label: t('shell.users'),
            description: t('shell.usersHint'),
            to: '/dashboard/users',
            icon: 'i-lucide-users',
        })
    }
    if (publicFlags.value.mastraAdmin) {
        children.push({
            label: t('shell.ai'),
            description: t('shell.aiHint'),
            to: '/dashboard/settings/ai',
            icon: 'i-lucide-bot',
        })
    }
    if (publicFlags.value.promptMgmt) {
        children.push({
            label: t('shell.prompts'),
            description: t('shell.promptsHint'),
            to: '/dashboard/prompts',
            icon: 'i-lucide-message-square-text',
        })
    }
    if (publicFlags.value.rag) {
        children.push({
            label: t('shell.rag'),
            description: t('shell.ragHint'),
            to: '/dashboard/rag',
            icon: 'i-lucide-library-big',
        })
    }
    if (children.length === 0) return base

    return [
        ...base,
        {
            label: t('shell.admin'),
            icon: 'i-lucide-shield',
            children,
        },
    ]
})

</script>
