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

        <UForm
            v-else
            :state="state"
            :schema="signupSchema"
            novalidate
            class="space-y-4"
            @submit="onSubmit"
        >
            <UFormField
                :label="t('auth.signup.email')"
                name="email"
                :help="t('auth.signup.emailHint')"
                eager-validation
                required
            >
                <div data-allow-mismatch>
                    <UInput
                        v-model="state.email"
                        type="email"
                        autocomplete="email"
                        required
                        class="w-full"
                    />
                </div>
            </UFormField>
            <UFormField
                :label="t('auth.signup.password')"
                name="password"
                :description="t('auth.signup.passwordHint', { min: PASSWORD_MIN_LENGTH })"
                eager-validation
                required
            >
                <div data-allow-mismatch>
                    <UInput
                        v-model="state.password"
                        type="password"
                        autocomplete="new-password"
                        required
                        class="w-full"
                    />
                </div>
            </UFormField>
            <UButton type="submit" loading-auto block>
                {{ t('auth.signup.submit') }}
            </UButton>
            <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
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
import { checkPasswordPolicy, PASSWORD_MIN_LENGTH } from '#shared/utils/password-policy'

definePageMeta({ layout: 'auth' })

// Hide the page when self-service signup is closed (the default): throwing a 404 in setup renders Nuxt's real 404 page,
// making it indistinguishable from a nonexistent route instead of revealing that signup is disabled.
const runtimeConfig = useRuntimeConfig()
if (runtimeConfig.public.allowRegistration !== true) {
    throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true })
}

const { t } = useI18n()

const signupSchema = computed(() =>
    z.object({
        email: z.email(t('auth.signup.validation.email')),
        password: z.string().superRefine((password, ctx) => {
            const policy = checkPasswordPolicy(password)
            if (!policy.valid) {
                ctx.addIssue({
                    code: 'custom',
                    message: t(`auth.signup.validation.${policy.code}`, {
                        min: PASSWORD_MIN_LENGTH,
                    }),
                })
            }
        }),
    }),
)

const state = reactive({ email: '', password: '' })
const error = ref<string | null>(null)
const sent = ref(false)
const { signup } = useAuth()

async function onSubmit() {
    error.value = null
    try {
        await signup(state.email, state.password)
        // No auto-login (anti-enumeration). Show a neutral "check your email"
        // state; the user verifies / signs in from there.
        sent.value = true
    } catch (e: unknown) {
        error.value = serverErrorMessage(e, t('auth.signup.errors.generic'))
    }
}
</script>
