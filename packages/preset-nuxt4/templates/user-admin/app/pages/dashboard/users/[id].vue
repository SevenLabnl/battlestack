<script setup lang="ts">
definePageMeta({ middleware: 'admin' })

interface UserRow {
    id: string
    name: string
    email: string
    role: 'admin' | 'user'
    createdAt: string
}

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const userId = computed(() => String(route.params.id))
const { user: sessionUser } = useUserSession()
// SSR cookie forward: admin-gated API.
const headers = useRequestHeaders(['cookie'])

const { data: user, refresh } = await useAsyncData<UserRow>(
    () => `user-${userId.value}`,
    () => $fetch(`/api/users/${userId.value}`, { headers }),
)

const form = reactive({
    email: '',
    name: '',
    password: '',
    role: 'user' as 'admin' | 'user',
})
const formError = ref('')
const showDelete = ref(false)

const roleItems = computed(() => [
    { label: t('userAdmin.roles.user'), value: 'user' },
    { label: t('userAdmin.roles.admin'), value: 'admin' },
])

watchEffect(() => {
    if (!user.value) return
    form.email = user.value.email
    form.name = user.value.name
    form.role = user.value.role
})

const isSelf = computed(() => (sessionUser.value as { id?: string } | null)?.id === userId.value)

async function save() {
    formError.value = ''
    try {
        const patch: Record<string, unknown> = {
            email: form.email,
            name: form.name,
            role: form.role,
        }
        if (form.password) patch.password = form.password
        await $fetch(`/api/users/${userId.value}`, { method: 'PUT', body: patch })
        form.password = ''
        await refresh()
        toast.add({ title: t('userAdmin.edit.savedTitle'), color: 'success' })
    } catch (e) {
        const msg =
            (e as { statusMessage?: string; message?: string }).statusMessage ||
            (e as Error).message ||
            t('userAdmin.edit.saveFailed')
        formError.value = msg
        toast.add({ title: t('userAdmin.edit.saveFailedTitle'), description: msg, color: 'error' })
    }
}

async function destroy() {
    try {
        await $fetch(`/api/users/${userId.value}`, { method: 'DELETE' })
        toast.add({ title: t('userAdmin.edit.deletedTitle'), color: 'success' })
        router.push('/dashboard/users')
    } catch (e) {
        const msg =
            (e as { statusMessage?: string; message?: string }).statusMessage ||
            (e as Error).message ||
            t('userAdmin.edit.deleteFailed')
        formError.value = msg
        showDelete.value = false
        toast.add({
            title: t('userAdmin.edit.deleteFailedTitle'),
            description: msg,
            color: 'error',
        })
    }
}
</script>

<template>
    <UCard>
        <template #header>
            <div class="flex items-center justify-between">
                <h1 class="text-lg font-medium">{{ t('userAdmin.edit.title') }}</h1>
                <UButton variant="ghost" icon="i-lucide-arrow-left" to="/dashboard/users">{{
                    t('userAdmin.edit.back')
                }}</UButton>
            </div>
        </template>

        <form v-if="user" class="space-y-3" @submit.prevent="save">
            <UFormField :label="t('userAdmin.create.email')" required>
                <UInput v-model="form.email" type="email" required class="w-full" />
            </UFormField>
            <UFormField :label="t('userAdmin.create.name')">
                <UInput v-model="form.name" class="w-full" />
            </UFormField>
            <UFormField :label="t('userAdmin.edit.passwordPlaceholder')">
                <UInput v-model="form.password" type="password" class="w-full" />
            </UFormField>
            <UFormField :label="t('userAdmin.create.role')">
                <USelect v-model="form.role" :items="roleItems" />
            </UFormField>
            <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
            <div class="flex gap-2 justify-between">
                <UButton
                    v-if="!isSelf"
                    color="error"
                    variant="ghost"
                    icon="i-lucide-trash-2"
                    @click="showDelete = true"
                >
                    {{ t('userAdmin.edit.delete') }}
                </UButton>
                <span v-else />
                <UButton type="submit" color="primary">{{ t('userAdmin.edit.save') }}</UButton>
            </div>
        </form>

        <UModal v-model:open="showDelete">
            <template #content>
                <UCard>
                    <template #header>{{ t('userAdmin.edit.deleteTitle') }}</template>
                    <i18n-t keypath="userAdmin.edit.deleteConfirm" tag="p">
                        <template #email>
                            <b>{{ user?.email }}</b>
                        </template>
                    </i18n-t>
                    <div class="mt-4 flex gap-2 justify-end">
                        <UButton color="neutral" variant="ghost" @click="showDelete = false">{{
                            t('userAdmin.edit.cancel')
                        }}</UButton>
                        <UButton color="error" @click="destroy">{{
                            t('userAdmin.edit.deleteConfirmAction')
                        }}</UButton>
                    </div>
                </UCard>
            </template>
        </UModal>
    </UCard>
</template>
