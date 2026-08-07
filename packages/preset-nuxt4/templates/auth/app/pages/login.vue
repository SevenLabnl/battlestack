<template>
    <div class="space-y-6">
        <h1 class="text-xl font-semibold">
            {{ step === 'mfa' ? t('auth.login.mfaTitle') : t('auth.login.title') }}
        </h1>

        <UForm
            v-if="step === 'credentials'"
            :state="state"
            :schema="loginSchema"
            class="space-y-4"
            @submit="onSubmit"
        >
            <UFormField :label="t('auth.login.email')" name="email">
                <!-- data-allow-mismatch: password managers (LastPass, 1Password, etc.) inject sibling DOM into credential
                         inputs after SSR lands and before hydration, which otherwise prints cascading mismatch warnings. -->
                <div data-allow-mismatch>
                    <UInput
                        v-model="state.email"
                        type="email"
                        autocomplete="email"
                        class="w-full"
                    />
                </div>
            </UFormField>
            <UFormField :label="t('auth.login.password')" name="password">
                <div data-allow-mismatch>
                    <UInput
                        v-model="state.password"
                        :type="showPassword ? 'text' : 'password'"
                        autocomplete="current-password"
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
                                        ? t('auth.login.hidePassword')
                                        : t('auth.login.showPassword')
                                "
                                @click="showPassword = !showPassword"
                            />
                        </template>
                    </UInput>
                </div>
            </UFormField>
            <UButton type="submit" :loading="loading" block>{{ t('auth.login.submit') }}</UButton>
            <p v-if="error" class="text-sm text-error">{{ error }}</p>
            <p v-if="needsVerification && verificationSent" class="text-sm text-muted">
                {{ t('auth.login.verification.sent') }}
            </p>
            <UButton
                v-else-if="needsVerification"
                variant="link"
                size="sm"
                :loading="resending"
                class="px-0"
                @click="resendVerification"
            >
                {{ t('auth.login.verification.resend') }}
            </UButton>

            <div v-if="passkeysEnabled || anyOauthEnabled" class="space-y-2 pt-2">
                <div class="flex items-center gap-3 text-xs text-muted">
                    <div class="h-px flex-1 bg-default" />
                    <span>{{ t('auth.login.orSeparator') }}</span>
                    <div class="h-px flex-1 bg-default" />
                </div>
                <UButton
                    v-if="passkeysEnabled"
                    block
                    color="neutral"
                    variant="outline"
                    icon="i-lucide-key"
                    :loading="passkeyLoading"
                    @click="onPasskeyLogin"
                >
                    {{ t('auth.login.passkey') }}
                </UButton>
                <UButton
                    v-if="oauthProviders.github"
                    block
                    color="neutral"
                    variant="outline"
                    icon="i-simple-icons-github"
                    to="/api/auth/oauth/github"
                    external
                >
                    {{ t('auth.login.oauth.github') }}
                </UButton>
                <UButton
                    v-if="oauthProviders.google"
                    block
                    color="neutral"
                    variant="outline"
                    icon="i-logos-google-icon"
                    to="/api/auth/oauth/google"
                    external
                >
                    {{ t('auth.login.oauth.google') }}
                </UButton>
            </div>
        </UForm>

        <UForm v-else :state="mfaState" :schema="mfaSchema" class="space-y-4" @submit="onMfaSubmit">
            <UFormField
                :label="t('auth.login.mfaCode')"
                name="code"
                :description="t('auth.login.mfaHint')"
            >
                <UInput
                    v-model="mfaState.code"
                    autocomplete="one-time-code"
                    maxlength="19"
                    class="w-full font-mono"
                />
            </UFormField>
            <UButton type="submit" :loading="loading" block>{{
                t('auth.login.mfaSubmit')
            }}</UButton>
            <p v-if="error" class="text-sm text-error">{{ error }}</p>
        </UForm>

        <div class="flex items-center justify-between gap-4">
            <NuxtLink
                v-if="registrationEnabled"
                to="/signup"
                class="text-sm text-muted hover:text-primary"
            >
                {{ t('auth.login.noAccount') }} {{ t('auth.login.signup') }}
            </NuxtLink>
            <span v-else />

            <NuxtLink
                v-if="recoveryEnabled"
                to="/forgot-password"
                class="text-sm text-muted hover:text-primary"
            >
                {{ t('auth.login.forgotPassword') }}
            </NuxtLink>
        </div>
    </div>
</template>

<script setup lang="ts">
import { z } from 'zod'

definePageMeta({ layout: 'auth' })

const { t } = useI18n()

const loginSchema = z.object({
    email: z.email(t('auth.login.validation.email')),
    password: z.string().min(1, t('auth.login.validation.password')),
})

// Accept either a 6-digit TOTP or a backup code (`xxxx-xxxx-xxxx-xxxx`, dashes optional).
const mfaSchema = z.object({
    code: z
        .string()
        .min(6)
        .refine(
            (v) =>
                /^\d{6}$/.test(v) ||
                /^[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}$/i.test(v),
            t('auth.login.validation.mfaCode'),
        ),
})

const step = ref<'credentials' | 'mfa'>('credentials')
const showPassword = ref(false)
const state = reactive({ email: '', password: '' })
const mfaState = reactive({ code: '' })
const mfaToken = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
// Email-verification gate (nuxt:auth-verification): login can 403 with
// `EMAIL_NOT_VERIFIED`; offer a resend without needing a session.
const needsVerification = ref(false)
const verificationSent = ref(false)
const resending = ref(false)
const { login, completeMfaChallenge } = useAuth()
const config = useRuntimeConfig()
const recoveryEnabled = config.public.authRecovery === true
const registrationEnabled = config.public.allowRegistration === true
const passkeysEnabled = (config.public as { authPasskeys?: boolean }).authPasskeys === true
const oauthRaw = (config.public as { oauthProviders?: Record<string, boolean> }).oauthProviders
const oauthProviders = {
    github: oauthRaw?.github === true,
    google: oauthRaw?.google === true,
}
const anyOauthEnabled = oauthProviders.github || oauthProviders.google
const passkeyLoading = ref(false)

// `usePasskey` wraps `useWebAuthn`, which calls `onMounted` internally; invoking it from inside an async button
// handler throws "no active component instance" and loses WebAuthn ceremony state, so resolve it once here at setup time.
type PasskeyApi = { signIn: (email: string) => Promise<unknown> }
const nuxtApp = useNuxtApp() as unknown as { $battlestackPasskey?: () => PasskeyApi }
const passkey
    = passkeysEnabled && typeof nuxtApp.$battlestackPasskey === 'function'
        ? nuxtApp.$battlestackPasskey()
        : null
const { fetch: refreshSession } = useUserSession()

async function onSubmit() {
    loading.value = true
    error.value = null
    needsVerification.value = false
    verificationSent.value = false
    try {
        const res = await login(state.email, state.password)
        if ('requiresMfa' in res) {
            mfaToken.value = res.mfaToken
            step.value = 'mfa'
            return
        }
        await navigateTo('/dashboard')
    } catch (e: unknown) {
        if ((e as { data?: { code?: string } }).data?.code === 'EMAIL_NOT_VERIFIED') {
            needsVerification.value = true
            error.value = t('auth.login.verification.required')
        } else {
            error.value = serverErrorMessage(e, t('auth.login.errors.generic'))
        }
    } finally {
        loading.value = false
    }
}

async function resendVerification() {
    resending.value = true
    try {
        await $fetch('/api/auth/resend-verification', {
            method: 'POST',
            body: { email: state.email },
        })
        verificationSent.value = true
    } catch {
        // Endpoint always returns ok; ignore transient failures.
        verificationSent.value = true
    } finally {
        resending.value = false
    }
}

async function onPasskeyLogin() {
    if (!passkey) return
    passkeyLoading.value = true
    error.value = null
    try {
        await passkey.signIn(state.email)
        // `useWebAuthn` sets the server-side session, but `useUserSession`'s SPA cache still reports `loggedIn: false` until next mount.
        // Force-refresh before navigating so route middleware passes.
        await refreshSession()
        await navigateTo('/dashboard')
    } catch (e: unknown) {
        error.value = serverErrorMessage(e, t('auth.login.errors.passkey'))
    } finally {
        passkeyLoading.value = false
    }
}

async function onMfaSubmit() {
    if (!mfaToken.value) return
    loading.value = true
    error.value = null
    try {
        await completeMfaChallenge(mfaToken.value, mfaState.code)
        await navigateTo('/dashboard')
    } catch (e: unknown) {
        error.value = serverErrorMessage(e, t('auth.login.errors.mfa'))
    } finally {
        loading.value = false
    }
}
</script>
