<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ middleware: 'admin' })

interface UserRow {
    id: string
    name: string
    email: string
    role: 'admin' | 'user'
    createdAt: string
}

interface UserList {
    rows: UserRow[]
    total: number
    limit: number
    offset: number
}

const { t } = useI18n()
const PAGE_SIZE = 50
const search = ref('')
const page = ref(0)
// SSR cookie forward: `requireRole` 401s otherwise.
const headers = useRequestHeaders(['cookie'])
const { data, status, refresh } = await useAsyncData<UserList>(
    'users-admin-list',
    () =>
        $fetch('/api/users', {
            query: {
                search: search.value || undefined,
                limit: PAGE_SIZE,
                offset: page.value * PAGE_SIZE,
            },
            headers,
        }),
    { watch: [search, page] },
)
watch(search, () => (page.value = 0))
const pageCount = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / PAGE_SIZE)))

const columns = computed<TableColumn<UserRow>[]>(() => [
    { accessorKey: 'email', header: t('userAdmin.columns.email') },
    { accessorKey: 'name', header: t('userAdmin.columns.name') },
    { accessorKey: 'role', header: t('userAdmin.columns.role') },
    { accessorKey: 'createdAt', header: t('userAdmin.columns.createdAt') },
])

const roleItems = computed(() => [
    { label: t('userAdmin.roles.user'), value: 'user' },
    { label: t('userAdmin.roles.admin'), value: 'admin' },
])

const toast = useToast()
const showCreate = ref(false)
const newUser = reactive({ email: '', password: '', name: '', role: 'user' as 'admin' | 'user' })
const createError = ref('')

async function createUser() {
    createError.value = ''
    try {
        await $fetch('/api/users', { method: 'POST', body: newUser })
        showCreate.value = false
        Object.assign(newUser, { email: '', password: '', name: '', role: 'user' })
        await refresh()
        toast.add({ title: t('userAdmin.create.successTitle'), color: 'success' })
    } catch (e) {
        const msg =
            (e as { statusMessage?: string; message?: string }).statusMessage ||
            (e as Error).message ||
            t('userAdmin.create.failed')
        createError.value = msg
        toast.add({ title: t('userAdmin.create.failedTitle'), description: msg, color: 'error' })
    }
}
</script>

<template>
    <UCard>
        <template #header>
            <div class="flex items-center justify-between">
                <h1 class="text-lg font-medium">{{ t('userAdmin.title') }}</h1>
                <UButton icon="i-lucide-plus" @click="showCreate = true">{{
                    t('userAdmin.new')
                }}</UButton>
            </div>
        </template>

        <UInput
            v-model="search"
            type="search"
            :placeholder="t('userAdmin.searchPlaceholder')"
            icon="i-lucide-search"
            autocomplete="off"
            data-lpignore="true"
            data-1p-ignore="true"
            class="mb-4"
        />

        <UTable :data="data?.rows ?? []" :columns="columns" :loading="status === 'pending'">
            <template #email-cell="{ row }">
                <NuxtLink
                    :to="`/dashboard/users/${row.original.id}`"
                    class="text-primary-600 hover:underline"
                >
                    {{ row.original.email }}
                </NuxtLink>
            </template>
            <template #role-cell="{ row }">
                <UBadge :color="row.original.role === 'admin' ? 'primary' : 'neutral'">
                    {{ row.original.role }}
                </UBadge>
            </template>
            <template #createdAt-cell="{ row }">
                {{ new Date(row.original.createdAt).toLocaleDateString() }}
            </template>
        </UTable>

        <div
            v-if="(data?.total ?? 0) > PAGE_SIZE"
            class="flex items-center justify-between mt-4 text-sm"
        >
            <span class="text-neutral-500">
                {{
                    t('userAdmin.pagination.range', {
                        from: page * PAGE_SIZE + 1,
                        to: Math.min((page + 1) * PAGE_SIZE, data?.total ?? 0),
                        total: data?.total ?? 0,
                    })
                }}
            </span>
            <div class="flex gap-2">
                <UButton :disabled="page === 0" variant="ghost" @click="page--">{{
                    t('userAdmin.pagination.previous')
                }}</UButton>
                <UButton :disabled="page >= pageCount - 1" variant="ghost" @click="page++">{{
                    t('userAdmin.pagination.next')
                }}</UButton>
            </div>
        </div>

        <UModal v-model:open="showCreate">
            <template #content>
                <UCard>
                    <template #header>{{ t('userAdmin.create.title') }}</template>
                    <form class="space-y-3" @submit.prevent="createUser">
                        <UFormField :label="t('userAdmin.create.email')" required>
                            <UInput v-model="newUser.email" type="email" required class="w-full" />
                        </UFormField>
                        <UFormField :label="t('userAdmin.create.name')">
                            <UInput v-model="newUser.name" class="w-full" />
                        </UFormField>
                        <UFormField :label="t('userAdmin.create.password')" required>
                            <UInput
                                v-model="newUser.password"
                                type="password"
                                required
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField :label="t('userAdmin.create.role')">
                            <USelect v-model="newUser.role" :items="roleItems" />
                        </UFormField>
                        <p v-if="createError" class="text-sm text-red-600">{{ createError }}</p>
                        <div class="flex gap-2 justify-end">
                            <UButton color="neutral" variant="ghost" @click="showCreate = false">{{
                                t('userAdmin.create.cancel')
                            }}</UButton>
                            <UButton type="submit" color="primary">{{
                                t('userAdmin.create.submit')
                            }}</UButton>
                        </div>
                    </form>
                </UCard>
            </template>
        </UModal>
    </UCard>
</template>
