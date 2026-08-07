<template>
    <UCard>
        <template #header>
            <h1 class="text-xl font-semibold">{{ t('auth.signup.title') }}</h1>
        </template>

        <!-- Anti-enumeration: the same success state shows whether the email was
             new or already registered; it never reveals which. -->
        <div v-if="sent" class="space-y-2">
            <p class="font-medium">{{ t('auth.signup.success.title') }}</p>
            <p class="text-sm text-muted">{{ t('auth.signup.success.description') }}</p>
        </div>

        <UForm v-else :state="state" :schema="signupSchema" class="space-y-4" @submit="onSubmit">
            <UFormField :label="t('auth.signup.email')" name="email">
                <div data-allow-mismatch>
                    <UInput
                        v-model="state.email"
                        type="email"
                        autocomplete="email"
                        class="w-full"
                    />
                </div>
            </UFormField>
            <UFormField
                :label="t('auth.signup.password')"
                name="password"
                :description="t('auth.signup.passwordHint', { min: MIN })"
            >
                <div data-allow-mismatch>
                    <UInput
                        v-model="state.password"
                        type="password"
                        autocomplete="new-password"
                        class="w-full"
                    />
                </div>
            </UFormField>
            <UButton type="submit" :loading="loading" block>
                {{ t('auth.signup.submit') }}
            </UButton>
            <p v-if="error" class="text-sm text-error">{{ error }}</p>
        </UForm>

        <template #footer>
            <NuxtLink to="/login" class="text-sm text-muted hover:text-primary">
                {{ t('auth.signup.haveAccount') }} {{ t('auth.signup.signIn') }}
            </NuxtLink>
        </template>
    </UCard>
</template>

<script setup lang="ts">
import { z } from 'zod'

definePageMeta({ layout: 'auth' })

// Hide the page when self-service signup is closed (the default): throwing a 404 in setup renders Nuxt's real 404 page,
// making it indistinguishable from a nonexistent route instead of revealing that signup is disabled.
const runtimeConfig = useRuntimeConfig()
if (runtimeConfig.public.allowRegistration !== true) {
    throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true })
}

const { t } = useI18n()

const MIN = 12

const signupSchema = z.object({
    email: z.email(t('auth.signup.validation.email')),
    password: z
        .string()
        .min(MIN, t('auth.signup.validation.minLength', { min: MIN }))
        .regex(/[a-z]/, t('auth.signup.validation.lowercase'))
        .regex(/[A-Z]/, t('auth.signup.validation.uppercase'))
        .regex(/[0-9]/, t('auth.signup.validation.digit'))
        .regex(/[^a-zA-Z0-9]/, t('auth.signup.validation.symbol')),
})

const state = reactive({ email: '', password: '' })
const loading = ref(false)
const error = ref<string | null>(null)
const sent = ref(false)
const { signup } = useAuth()

async function onSubmit() {
    loading.value = true
    error.value = null
    try {
        await signup(state.email, state.password)
        // No auto-login (anti-enumeration). Show a neutral "check your email"
        // state; the user verifies / signs in from there.
        sent.value = true
    } catch (e: unknown) {
        error.value = serverErrorMessage(e, t('auth.signup.errors.generic'))
    } finally {
        loading.value = false
    }
}
</script>
