<template>
    <div class="mx-auto max-w-2xl space-y-6">
        <div>
            <h1 class="text-2xl font-bold tracking-tight">{{ t('dashboard.profile.title') }}</h1>
            <p class="mt-1 text-sm text-muted">{{ t('dashboard.profile.subtitle') }}</p>
        </div>

        <UCard>
            <UForm :state="state" :schema="profileSchema" class="space-y-5" @submit="onSubmit">
                <UFormField :label="t('dashboard.profile.name')" name="name">
                    <UInput v-model="state.name" size="lg" class="w-full" />
                </UFormField>

                <UFormField :label="t('dashboard.profile.email')">
                    <UInput :model-value="user?.email ?? ''" size="lg" class="w-full" disabled />
                </UFormField>

                <div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <UFormField :label="t('dashboard.profile.theme')" name="theme">
                        <USelectMenu
                            v-model="state.theme"
                            :items="themeOptions"
                            value-key="value"
                            size="lg"
                            class="w-full"
                        />
                    </UFormField>

                    <UFormField :label="t('dashboard.profile.locale')" name="locale">
                        <USelectMenu
                            v-model="state.locale"
                            :items="localeOptions"
                            value-key="value"
                            size="lg"
                            class="w-full"
                        />
                    </UFormField>
                </div>

                <div class="flex justify-end border-t border-default pt-4">
                    <UButton type="submit" :loading="saving" icon="i-lucide-save">
                        {{ t('dashboard.profile.save') }}
                    </UButton>
                </div>
            </UForm>
        </UCard>
    </div>
</template>

<script setup lang="ts">
import { z } from 'zod'

const { t, setLocale } = useI18n()
const { user, fetchUser } = useAuth()
const toast = useToast()
const colorMode = useColorMode()

const themeOptions = computed(() => [
    { label: t('dashboard.profile.themeOptions.light'), value: 'light' },
    { label: t('dashboard.profile.themeOptions.dark'), value: 'dark' },
    { label: t('dashboard.profile.themeOptions.system'), value: 'system' },
])
// Labels in native script: recovery from wrong-locale selection.
const localeOptions = [
    { label: 'Nederlands', value: 'nl' },
    { label: 'English', value: 'en' },
]

const profileSchema = z.object({
    name: z.string().max(80),
    theme: z.enum(['light', 'dark', 'system']),
    locale: z.enum(['nl', 'en']),
})

const state = reactive({
    name: '',
    theme: 'system' as 'light' | 'dark' | 'system',
    locale: 'nl' as 'nl' | 'en',
})
const saving = ref(false)

watch(
    user,
    (val) => {
        if (val) {
            state.name = (val.name as string | undefined) ?? ''
            state.theme = (val.theme as 'light' | 'dark' | 'system' | undefined) ?? 'system'
            state.locale = (val.locale as 'nl' | 'en' | undefined) ?? 'nl'
        }
    },
    { immediate: true },
)

async function onSubmit() {
    saving.value = true
    try {
        await $fetch('/api/auth/profile', { method: 'PUT', body: state })
        colorMode.preference = state.theme
        setLocale(state.locale)
        await fetchUser()
        toast.add({ title: t('dashboard.profile.saved'), color: 'success' })
    } catch (e: unknown) {
        const msg = (e as { statusMessage?: string }).statusMessage ?? t('dashboard.profile.error')
        toast.add({
            title: t('dashboard.profile.errorTitle'),
            description: msg,
            color: 'error',
        })
    } finally {
        saving.value = false
    }
}
</script>
