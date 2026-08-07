<script setup lang="ts">
definePageMeta({ middleware: 'admin' })

interface PromptRow {
    id: string
    key: string
    name: string
    description: string
    content: string
    version: number
    updatedAt: string
}

interface PromptList {
    rows: PromptRow[]
    total: number
    limit: number
    offset: number
}

const { t } = useI18n()
// SSR cookie forward: `requireRole` 401s otherwise.
const headers = useRequestHeaders(['cookie'])
const toast = useToast()
const { data, pending, refresh } = await useAsyncData<PromptList>('prompts-admin-list', () =>
    $fetch('/api/prompts', { headers }),
)

const editing = ref<Record<string, string>>({})
const errors = ref<Record<string, string>>({})

function startEdit(p: PromptRow) {
    editing.value[p.id] = p.content
    errors.value[p.id] = ''
}

async function save(p: PromptRow) {
    const content = editing.value[p.id]
    if (typeof content !== 'string') return
    errors.value[p.id] = ''
    try {
        await $fetch(`/api/prompts/${p.id}`, {
            method: 'PUT',
            body: { content },
        })
        Reflect.deleteProperty(editing.value, p.id)
        await refresh()
        toast.add({ title: t('prompts.savedTitle', { name: p.name }), color: 'success' })
    } catch (e) {
        const msg =
            (e as { statusMessage?: string }).statusMessage ||
            (e as Error).message ||
            t('prompts.saveFailed')
        errors.value[p.id] = msg
        toast.add({ title: t('prompts.saveFailedTitle'), description: msg, color: 'error' })
    }
}

async function reset(p: PromptRow) {
    if (!confirm(t('prompts.resetConfirm', { key: p.key }))) return
    try {
        await $fetch(`/api/prompts/${p.id}/reset`, { method: 'POST' })
        Reflect.deleteProperty(editing.value, p.id)
        await refresh()
        toast.add({ title: t('prompts.resetTitle', { name: p.name }), color: 'success' })
    } catch (e) {
        const msg =
            (e as { statusMessage?: string }).statusMessage ||
            (e as Error).message ||
            t('prompts.resetFailed')
        errors.value[p.id] = msg
        toast.add({ title: t('prompts.resetFailedTitle'), description: msg, color: 'error' })
    }
}
</script>

<template>
    <UCard>
        <template #header>
            <h1 class="text-lg font-medium">{{ t('prompts.title') }}</h1>
            <p class="text-sm text-muted">
                {{ t('prompts.subtitle') }}
            </p>
        </template>

        <div v-if="pending">{{ t('prompts.loading') }}</div>
        <div v-else class="space-y-4">
            <UCard v-for="p in data?.rows ?? []" :key="p.id" variant="subtle">
                <template #header>
                    <div class="flex items-center justify-between">
                        <div>
                            <div class="text-sm font-medium">{{ p.name }}</div>
                            <div class="font-mono text-xs text-muted">
                                {{ p.key }} · {{ t('prompts.version', { n: p.version }) }}
                            </div>
                            <div v-if="p.description" class="mt-1 text-xs text-muted">
                                {{ p.description }}
                            </div>
                        </div>
                        <div class="flex gap-2">
                            <UButton
                                v-if="!(p.id in editing)"
                                size="sm"
                                color="neutral"
                                variant="ghost"
                                icon="i-lucide-pencil"
                                @click="startEdit(p)"
                            >
                                {{ t('prompts.edit') }}
                            </UButton>
                            <UButton
                                size="sm"
                                color="error"
                                variant="ghost"
                                icon="i-lucide-rotate-ccw"
                                @click="reset(p)"
                            >
                                {{ t('prompts.reset') }}
                            </UButton>
                        </div>
                    </div>
                </template>

                <UTextarea
                    v-if="p.id in editing"
                    v-model="editing[p.id]"
                    :rows="6"
                    class="w-full font-mono text-sm"
                />
                <pre v-else class="whitespace-pre-wrap text-sm">{{ p.content }}</pre>

                <p v-if="errors[p.id]" class="mt-2 text-sm text-red-600">{{ errors[p.id] }}</p>

                <template v-if="p.id in editing" #footer>
                    <div class="flex justify-end gap-2">
                        <UButton color="neutral" variant="ghost" @click="delete editing[p.id]">
                            {{ t('prompts.cancel') }}
                        </UButton>
                        <UButton color="primary" @click="save(p)">{{ t('prompts.save') }}</UButton>
                    </div>
                </template>
            </UCard>
        </div>
    </UCard>
</template>
