<script setup lang="ts">
import { z } from 'zod'
import { PASSWORD_MIN_LENGTH } from '#shared/utils/password-policy'

definePageMeta({ middleware: 'admin' })

// Mirrors the `name` limit in the /api/users handlers.
const NAME_MAX_LENGTH = 80

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
    () => $fetch<UserRow>(`/api/users/${userId.value}`, { headers }),
)

const form = reactive({
    email: '',
    name: '',
    password: '',
    role: 'user' as 'admin' | 'user',
})
const formError = ref('')
const showDelete = ref(false)
const editSchema = computed(() =>
    z.object({
        email: z.email(t('auth.signup.validation.email')),
        name: z.string().max(NAME_MAX_LENGTH, t('userAdmin.validation.nameTooLong', { max: NAME_MAX_LENGTH })),
        password: passwordPolicySchema(t, { allowEmpty: true }),
    }),
)

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
        const msg = passwordPolicyServerMessage(e, t) ?? serverErrorMessage(e, t('userAdmin.edit.saveFailed'))
        formError.value = msg
        toast.add({ title: t('userAdmin.edit.saveFailedTitle'), description: msg, color: 'error' })
    }
}

async function destroy() {
    formError.value = ''
    try {
        await $fetch(`/api/users/${userId.value}`, { method: 'DELETE' })
        toast.add({ title: t('userAdmin.edit.deletedTitle'), color: 'success' })
        router.push('/dashboard/users')
    } catch (e) {
        const msg = serverErrorMessage(e, t('userAdmin.edit.deleteFailed'))
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

        <UForm
            v-if="user"
            :state="form"
            :schema="editSchema"
            novalidate
            class="space-y-3"
            @submit="save"
        >
            <UFormField
                :label="t('userAdmin.create.email')"
                name="email"
                :help="t('auth.signup.emailHint')"
                eager-validation
                required
            >
                <UInput
                    v-model="form.email"
                    type="email"
                    autocomplete="email"
                    required
                    class="w-full"
                />
            </UFormField>
            <UFormField :label="t('userAdmin.create.name')" name="name" eager-validation>
                <UInput v-model="form.name" class="w-full" />
            </UFormField>
            <UFormField
                :label="t('userAdmin.edit.passwordPlaceholder')"
                name="password"
                :help="t('auth.signup.passwordHint', { min: PASSWORD_MIN_LENGTH })"
                eager-validation
            >
                <UInput
                    v-model="form.password"
                    type="password"
                    autocomplete="new-password"
                    class="w-full"
                />
            </UFormField>
            <UFormField :label="t('userAdmin.create.role')">
                <USelect v-model="form.role" :items="roleItems" />
            </UFormField>
            <p v-if="formError" role="alert" class="text-sm text-error">{{ formError }}</p>
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
                <UButton type="submit" color="primary" loading-auto>{{ t('userAdmin.edit.save') }}</UButton>
            </div>
        </UForm>

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
                        <UButton color="error" loading-auto @click="destroy">{{
                            t('userAdmin.edit.deleteConfirmAction')
                        }}</UButton>
                    </div>
                </UCard>
            </template>
        </UModal>
    </UCard>
</template>
