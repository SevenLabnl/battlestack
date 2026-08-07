<template>
    <div class="space-y-6">
        <div>
            <h1 class="text-2xl font-bold tracking-tight">{{ t('rag.title') }}</h1>
            <p class="mt-1 text-muted">{{ t('rag.subtitle') }}</p>
        </div>

        <UCard>
            <template #header>
                <h2 class="font-semibold">{{ t('rag.ingest.heading') }}</h2>
            </template>
            <div class="space-y-3">
                <UFormField :label="t('rag.ingest.title')">
                    <UInput v-model="ingest.title" class="w-full" />
                </UFormField>
                <UFormField :label="t('rag.ingest.source')" :description="t('rag.ingest.sourceHint')">
                    <UInput v-model="ingest.source" class="w-full" />
                </UFormField>
                <UFormField :label="t('rag.ingest.text')">
                    <UTextarea v-model="ingest.text" :rows="6" class="w-full" />
                </UFormField>
                <UButton :loading="ingesting" :disabled="!canIngest" @click="onIngest">
                    {{ t('rag.ingest.submit') }}
                </UButton>
            </div>
        </UCard>

        <UCard>
            <template #header>
                <h2 class="font-semibold">{{ t('rag.query.heading') }}</h2>
            </template>
            <div class="space-y-3">
                <div class="flex gap-2">
                    <UInput
                        v-model="query"
                        class="flex-1"
                        :placeholder="t('rag.query.placeholder')"
                        @keydown.enter="onQuery"
                    />
                    <UButton :loading="querying" :disabled="!query.trim()" @click="onQuery">
                        {{ t('rag.query.submit') }}
                    </UButton>
                </div>

                <div v-if="results.length" class="space-y-2">
                    <div
                        v-for="(r, i) in results"
                        :key="i"
                        class="rounded border border-default p-3"
                    >
                        <div class="flex items-center justify-between gap-2 text-xs text-muted">
                            <span class="truncate">{{ resultLabel(r) }}</span>
                            <span class="font-mono shrink-0">{{ r.score.toFixed(3) }}</span>
                        </div>
                        <p class="mt-1 text-sm whitespace-pre-wrap">{{ resultText(r) }}</p>
                    </div>
                </div>
                <p v-else-if="queried" class="text-sm text-muted">{{ t('rag.query.empty') }}</p>
            </div>
        </UCard>
    </div>
</template>

<script setup lang="ts">
const { t } = useI18n()
const toast = useToast()

interface RagResult {
    score: number
    metadata: Record<string, unknown>
}

function errMessage(e: unknown, fallback: string): string {
    const err = e as { data?: { statusMessage?: string; message?: string } }
    return err.data?.statusMessage || err.data?.message || fallback
}
function resultLabel(r: RagResult): string {
    return String(r.metadata.source ?? r.metadata.title ?? '-')
}
function resultText(r: RagResult): string {
    return String(r.metadata.text ?? '')
}

const ingest = reactive({ title: '', source: '', text: '' })
const ingesting = ref(false)
const canIngest = computed(
    () => !!ingest.title.trim() && !!ingest.source.trim() && !!ingest.text.trim(),
)

async function onIngest() {
    ingesting.value = true
    try {
        const res = await $fetch<{ chunks: number }>('/api/rag/ingest', {
            method: 'POST',
            body: { title: ingest.title, source: ingest.source, text: ingest.text },
        })
        toast.add({ title: t('rag.ingest.success', { n: res.chunks }), color: 'success' })
        ingest.text = ''
    } catch (e: unknown) {
        toast.add({ title: t('rag.error'), description: errMessage(e, t('rag.error')), color: 'error' })
    } finally {
        ingesting.value = false
    }
}

const query = ref('')
const querying = ref(false)
const queried = ref(false)
const results = ref<RagResult[]>([])

async function onQuery() {
    if (!query.value.trim()) return
    querying.value = true
    try {
        const res = await $fetch<{ results: RagResult[] }>('/api/rag/query', {
            method: 'POST',
            body: { query: query.value },
        })
        results.value = res.results
        queried.value = true
    } catch (e: unknown) {
        toast.add({ title: t('rag.error'), description: errMessage(e, t('rag.error')), color: 'error' })
    } finally {
        querying.value = false
    }
}
</script>
