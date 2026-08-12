<template>
    <div class="flex h-full flex-col gap-4">
        <div class="flex-1 space-y-3 overflow-y-auto">
            <template v-for="m in messages" :key="m.id">
                <div
                    v-if="m.content || m.role === 'user'"
                    class="rounded-md p-3"
                    :class="m.role === 'user' ? 'bg-primary-50' : 'bg-muted'"
                >
                    <div class="text-xs uppercase tracking-wide text-muted">{{ m.role }}</div>
                    <div class="whitespace-pre-wrap">{{ m.content }}</div>
                </div>
            </template>

            <div
                v-if="status === 'streaming' && !messages.at(-1)?.content"
                class="rounded-md bg-muted p-3 text-sm text-muted"
            >
                <span class="inline-flex gap-1">
                    <span class="animate-bounce">·</span>
                    <span class="animate-bounce [animation-delay:120ms]">·</span>
                    <span class="animate-bounce [animation-delay:240ms]">·</span>
                </span>
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

async function onSubmit(e?: Event) {
    await handleSubmit(e)
    focusInput()
}

const errorMessage = computed(() => {
    const raw = (error.value as { message?: string } | null | undefined)?.message ?? ''
    if (/NUXT_AI_GATEWAY_KEY/i.test(raw)) return t('chat.errorMissingKey')
    if (/NUXT_AI_GATEWAY_URL/i.test(raw)) return t('chat.errorMissingUrl')
    return raw || t('chat.errorGeneric')
})
</script>
