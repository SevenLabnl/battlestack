<template>
    <UCard>
        <template #header>
            <h1 class="text-xl font-semibold">{{ t('authRecovery.forgot.title') }}</h1>
        </template>

        <UForm v-if="!sent" :state="state" :schema="schema" class="space-y-4" @submit="onSubmit">
            <UFormField :label="t('authRecovery.forgot.email')" name="email">
                <div data-allow-mismatch>
                    <UInput
                        v-model="state.email"
                        type="email"
                        autocomplete="email"
                        class="w-full"
                    />
                </div>
            </UFormField>
            <UButton type="submit" :loading="loading" block>
                {{ t('authRecovery.forgot.submit') }}
            </UButton>
            <p v-if="error" class="text-sm text-error">{{ error }}</p>
        </UForm>

        <UAlert
            v-else
            color="success"
            icon="i-lucide-circle-check"
            :title="t('authRecovery.forgot.success.title')"
            :description="t('authRecovery.forgot.success.description')"
        />

        <template #footer>
            <NuxtLink to="/login" class="text-sm text-muted hover:text-primary">
                {{ t('authRecovery.forgot.backToSignIn') }}
            </NuxtLink>
        </template>
    </UCard>
</template>

<script setup lang="ts">
import { z } from 'zod'

definePageMeta({ layout: 'auth' })

const { t } = useI18n()

const schema = z.object({
    email: z.email(t('authRecovery.forgot.validation.email')),
})

const state = reactive({ email: '' })
const loading = ref(false)
const error = ref<string | null>(null)
const sent = ref(false)

async function onSubmit() {
    loading.value = true
    error.value = null
    try {
        await $fetch('/api/auth/forgot-password', { method: 'POST', body: state })
        sent.value = true
    } catch (e: unknown) {
        error.value = serverErrorMessage(e, t('authRecovery.forgot.errors.generic'))
    } finally {
        loading.value = false
    }
}
</script>
