<template>
    <div class="mx-auto max-w-2xl space-y-6">
        <div>
            <h1 class="text-2xl font-bold tracking-tight">{{ t('dashboard.profile.title') }}</h1>
            <p class="mt-1 text-sm text-muted">{{ t('dashboard.profile.subtitle') }}</p>
        </div>

        <UCard>
            <div class="flex items-center gap-5">
                <div class="shrink-0">
                    <img
                        v-if="avatarUrl"
                        :src="avatarUrl"
                        :alt="user?.name || user?.email || ''"
                        class="h-20 w-20 rounded-full object-cover ring-2 ring-default"
                    />
                    <div
                        v-else
                        class="flex h-20 w-20 items-center justify-center rounded-full bg-elevated text-xl font-semibold text-muted select-none"
                    >
                        {{ initials }}
                    </div>
                </div>
                <div class="flex flex-col gap-2">
                    <input
                        ref="avatarInput"
                        type="file"
                        accept="image/*"
                        class="hidden"
                        @change="onAvatarChange"
                    />
                    <UButton
                        size="sm"
                        color="primary"
                        variant="soft"
                        icon="i-lucide-upload"
                        :loading="avatarUploading"
                        @click="avatarInput?.click()"
                    >
                        {{
                            avatarUploading
                                ? `${avatarProgress}%`
                                : t('dashboard.profile.avatar.upload')
                        }}
                    </UButton>
                    <UButton
                        v-if="avatarUrl"
                        size="sm"
                        color="error"
                        variant="ghost"
                        icon="i-lucide-trash-2"
                        :loading="avatarRemoving"
                        @click="removeAvatar"
                    >
                        {{ t('dashboard.profile.avatar.remove') }}
                    </UButton>
                </div>
            </div>
        </UCard>

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

// Avatar: shared state with `app/layouts/default.vue` (dropdown trigger).
const avatarUrl = useState<string | null>('battlestack-avatar-url', () => null)
const avatarInput = ref<HTMLInputElement | null>(null)
const avatarUploading = ref(false)
const avatarProgress = ref(0)
const avatarRemoving = ref(false)

const initials = computed(() => {
    const name: string = user.value?.name || user.value?.email || ''
    return name
        .split(/\s+/)
        .map((p: string) => p[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
})

onMounted(async () => {
    try {
        const r = await $fetch<{ avatarUrl: string | null }>('/api/auth/avatar')
        avatarUrl.value = r.avatarUrl
    } catch {
        // no avatar yet
    }
})

async function onAvatarChange(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    avatarUploading.value = true
    avatarProgress.value = 0
    try {
        const result = await new Promise<{ avatarUrl: string }>((resolve, reject) => {
            const form = new FormData()
            form.append('file', file)
            const xhr = new XMLHttpRequest()
            xhr.open('POST', '/api/auth/avatar', true)
            xhr.upload.onprogress = (ev) => {
                if (ev.lengthComputable)
                    avatarProgress.value = Math.round((ev.loaded / ev.total) * 100)
            }
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        resolve(JSON.parse(xhr.responseText))
                    } catch {
                        reject(new Error('Invalid response'))
                    }
                } else {
                    reject(new Error(`Upload failed: ${xhr.status}`))
                }
            }
            xhr.onerror = () => reject(new Error('Network error'))
            xhr.send(form)
        })
        avatarUrl.value = result.avatarUrl
        toast.add({ title: t('dashboard.profile.avatar.uploaded'), color: 'success' })
    } catch {
        toast.add({ title: t('dashboard.profile.avatar.uploadError'), color: 'error' })
    } finally {
        avatarUploading.value = false
        if (avatarInput.value) avatarInput.value.value = ''
    }
}

async function removeAvatar() {
    avatarRemoving.value = true
    try {
        await $fetch('/api/auth/avatar', { method: 'DELETE' })
        avatarUrl.value = null
        toast.add({ title: t('dashboard.profile.avatar.removed'), color: 'success' })
    } catch {
        toast.add({ title: t('dashboard.profile.avatar.removeError'), color: 'error' })
    } finally {
        avatarRemoving.value = false
    }
}
</script>
