<template>
    <UCard>
        <template #header>
            <h1 class="text-xl font-semibold">{{ t('authRecovery.reset.title') }}</h1>
        </template>

        <UForm v-if="!done" :state="state" :schema="schema" class="space-y-4" @submit="onSubmit">
            <UFormField
                :label="t('authRecovery.reset.newPassword')"
                name="password"
                :description="t('authRecovery.reset.hint')"
            >
                <div data-allow-mismatch>
                    <UInput
                        v-model="state.password"
                        :type="showPassword ? 'text' : 'password'"
                        autocomplete="new-password"
                        class="w-full"
                    >
                        <template #trailing>
                            <UButton
                                :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                                variant="link"
                                color="neutral"
                                size="sm"
                                :aria-label="
                                    showPassword
                                        ? t('authRecovery.reset.hidePassword')
                                        : t('authRecovery.reset.showPassword')
                                "
                                @click="showPassword = !showPassword"
                            />
                        </template>
                    </UInput>
                </div>
            </UFormField>
            <UFormField :label="t('authRecovery.reset.confirmPassword')" name="confirmPassword">
                <div data-allow-mismatch>
                    <UInput
                        v-model="state.confirmPassword"
                        :type="showPassword ? 'text' : 'password'"
                        autocomplete="new-password"
                        class="w-full"
                    />
                </div>
            </UFormField>
            <UButton type="submit" :loading="loading" block>
                {{ t('authRecovery.reset.submit') }}
            </UButton>
            <p v-if="error" class="text-sm text-error">{{ error }}</p>
        </UForm>

        <UAlert
            v-else
            color="success"
            icon="i-lucide-circle-check"
            :title="t('authRecovery.reset.success.title')"
            :description="t('authRecovery.reset.success.description')"
            :actions="[{ label: t('authRecovery.reset.success.cta'), to: '/login' }]"
        />
    </UCard>
</template>

<script setup lang="ts">
import { z } from 'zod'

definePageMeta({ layout: 'auth' })

const { t } = useI18n()
const route = useRoute()
const token = String(route.query.token ?? '')

const schema = z
    .object({
        password: z.string().min(12, t('authRecovery.reset.validation.minLength')),
        confirmPassword: z.string(),
    })
    .refine((v) => v.password === v.confirmPassword, {
        message: t('authRecovery.reset.validation.mismatch'),
        path: ['confirmPassword'],
    })

const state = reactive({ password: '', confirmPassword: '' })
const showPassword = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const done = ref(false)

async function onSubmit() {
    loading.value = true
    error.value = null
    try {
        await $fetch('/api/auth/reset-password', {
            method: 'POST',
            body: { token, password: state.password },
        })
        done.value = true
    } catch (e: unknown) {
        error.value = serverErrorMessage(e, t('authRecovery.reset.errors.generic'))
    } finally {
        loading.value = false
    }
}
</script>
