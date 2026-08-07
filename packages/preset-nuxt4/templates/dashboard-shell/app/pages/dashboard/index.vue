<template>
    <div class="space-y-6">
        <div>
            <h1 class="text-2xl font-bold tracking-tight">{{ t('dashboard.home.title') }}</h1>
            <p class="mt-1 text-muted">
                {{ t('dashboard.home.welcome', { name: user?.name || user?.email || '' }) }}
            </p>
            <p class="mt-1 text-sm text-muted">{{ t('dashboard.home.subtitle') }}</p>
        </div>

        <div v-if="quickLinks.length > 0" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <NuxtLink v-for="link in quickLinks" :key="link.to" :to="link.to" class="group">
                <UCard class="h-full transition hover:ring-primary hover:shadow-sm">
                    <div class="flex items-start gap-3">
                        <UIcon :name="link.icon" class="text-2xl text-primary shrink-0 mt-0.5" />
                        <div class="min-w-0">
                            <p class="font-semibold group-hover:text-primary">
                                {{ link.label }}
                            </p>
                            <p class="text-sm text-muted">{{ link.hint }}</p>
                        </div>
                    </div>
                </UCard>
            </NuxtLink>
        </div>

        <UCard
            v-else
            :title="t('dashboard.home.getStarted.title')"
            :description="t('dashboard.home.getStarted.description')"
        />
    </div>
</template>

<script setup lang="ts">
const { t } = useI18n()
const { user } = useAuth()
const runtimeConfig = useRuntimeConfig()

// Renders as "<dashboard title> - <app name>" via the titleTemplate in app.vue.
// Function form keeps it reactive when the locale changes.
useHead({ title: () => t('dashboard.home.title') })

const isAdmin = computed(
    () => (user.value as { role?: string } | null | undefined)?.role === 'admin',
)
const publicFlags = computed(
    () =>
        runtimeConfig.public as {
            userAdmin?: boolean
            mastraAdmin?: boolean
            promptMgmt?: boolean
        },
)

interface QuickLink {
    to: string
    icon: string
    label: string
    hint: string
}

const quickLinks = computed<QuickLink[]>(() => {
    const links: QuickLink[] = [
        {
            to: '/dashboard/profile',
            icon: 'i-lucide-user',
            label: t('dashboard.home.quickLinks.profile'),
            hint: t('dashboard.home.quickLinks.profileHint'),
        },
        {
            to: '/dashboard/security',
            icon: 'i-lucide-shield',
            label: t('dashboard.home.quickLinks.security'),
            hint: t('dashboard.home.quickLinks.securityHint'),
        },
    ]
    if (!isAdmin.value) return links

    if (publicFlags.value.userAdmin) {
        links.push({
            to: '/dashboard/users',
            icon: 'i-lucide-users',
            label: t('dashboard.home.quickLinks.users'),
            hint: t('dashboard.home.quickLinks.usersHint'),
        })
    }
    if (publicFlags.value.mastraAdmin) {
        links.push({
            to: '/dashboard/settings/ai',
            icon: 'i-lucide-bot',
            label: t('dashboard.home.quickLinks.ai'),
            hint: t('dashboard.home.quickLinks.aiHint'),
        })
    }
    return links
})
</script>
