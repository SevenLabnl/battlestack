<template>
    <div class="flex h-full flex-col gap-4">
        <div class="flex-1 space-y-3 overflow-y-auto">
            <div
                v-for="m in messages"
                :key="m.id"
                class="rounded-md p-3"
                :class="m.role === 'user' ? 'bg-primary-50' : 'bg-muted'"
            >
                <div class="text-xs uppercase tracking-wide text-muted">{{ m.role }}</div>
                <div class="whitespace-pre-wrap">{{ m.content }}</div>
            </div>
        </div>

        <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            :title="t('chat.errorTitle')"
            :description="errorMessage"
            icon="i-lucide-triangle-alert"
        />

        <form class="flex gap-2" @submit.prevent="onSubmit">
            <UInput
                ref="inputRef"
                v-model="input"
                :placeholder="t('chat.placeholder')"
                class="flex-1"
                autofocus
            />
            <UButton
                type="submit"
                :loading="isStreaming"
                :disabled="isStreaming"
            >
                {{ t('chat.send') }}
            </UButton>
        </form>
    </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'ChatPanel' })

const { t } = useI18n()
const { messages, input, handleSubmit, status, error } = useChatAgent()
const inputRef = useTemplateRef<{ inputRef?: HTMLInputElement | null }>('inputRef')

const isStreaming = computed(() => status.value === 'streaming')

function focusInput() {
    nextTick(() => inputRef.value?.inputRef?.focus())
}

function onSubmit(e?: Event) {
    handleSubmit(e)
    focusInput()
}

const errorMessage = computed(() => {
    if (!error.value) return ''
    if (error.value.kind === 'missing-key') return t('chat.errorMissingKey')
    if (error.value.kind === 'missing-url') return t('chat.errorMissingUrl')
    return error.value.message || t('chat.errorGeneric')
})
</script>
