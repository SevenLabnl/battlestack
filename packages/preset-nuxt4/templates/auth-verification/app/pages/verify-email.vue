<template>
    <UCard>
        <template #header>
            <h1 class="text-xl font-semibold">{{ t('authVerification.verify.title') }}</h1>
        </template>

        <p v-if="status === 'pending'" class="text-sm text-muted">
            {{ t('authVerification.verify.pending') }}
        </p>
        <UAlert
            v-else-if="status === 'ok'"
            color="success"
            icon="i-lucide-circle-check"
            :title="t('authVerification.verify.success.title')"
            :description="t('authVerification.verify.success.description')"
            :actions="[{ label: t('authVerification.verify.success.cta'), to: '/login' }]"
        />
        <UAlert
            v-else
            color="error"
            icon="i-lucide-circle-alert"
            :title="t('authVerification.verify.failure.title')"
            :description="error ?? t('authVerification.verify.failure.description')"
        />
    </UCard>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const { t } = useI18n()
const route = useRoute()
const token = String(route.query.token ?? '')
const status = ref<'pending' | 'ok' | 'fail'>('pending')
const error = ref<string | null>(null)

onMounted(async () => {
    try {
        await $fetch('/api/auth/verify-email', { method: 'POST', body: { token } })
        status.value = 'ok'
    } catch (e: unknown) {
        status.value = 'fail'
        error.value = serverErrorMessage(e, '') || null
    }
})
</script>
