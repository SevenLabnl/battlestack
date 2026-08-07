<template>
    <div class="space-y-2">
        <input ref="input" type="file" class="hidden" :accept="accept" @change="onChange" />
        <UButton color="primary" variant="soft" :loading="uploading" @click="input?.click()">
            {{ uploading ? `${progress}%` : 'Upload' }}
        </UButton>
        <p v-if="error" class="text-xs text-red-500">{{ error }}</p>
    </div>
</template>

<script setup lang="ts">
defineProps<{ accept?: string }>()
const emit = defineEmits<{ uploaded: [file: { key: string; size: number; mime: string | null }] }>()

const input = ref<HTMLInputElement | null>(null)
const { upload, uploading, progress, error } = useS3Upload()

async function onChange(e: Event) {
    const target = e.target as HTMLInputElement
    const file = target.files?.[0]
    if (!file) return
    try {
        const record = await upload(file)
        emit('uploaded', record)
    } finally {
        if (target) target.value = ''
    }
}
</script>
