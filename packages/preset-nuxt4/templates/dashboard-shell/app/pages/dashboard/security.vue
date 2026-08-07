<template>
    <div class="space-y-6">
        <div>
            <h1 class="text-2xl font-bold">{{ t('dashboard.security.title') }}</h1>
            <p class="mt-1 text-sm text-muted">{{ t('dashboard.security.subtitle') }}</p>
        </div>

        <!-- Each card is session-dependent data fetched in onMounted(), so SSR renders the empty state while client
             hydration gets a populated list (a Vue mismatch); ClientOnly defers these cards with skeleton fallbacks. -->
        <ClientOnly>
            <template #fallback>
                <USkeleton class="h-40 w-full" />
                <USkeleton class="h-32 w-full" />
            </template>

            <UCard v-if="passkeysAvailable">
                <template #header>
                    <div class="flex items-center justify-between">
                        <div>
                            <h2 class="text-base font-semibold">
                                {{ t('dashboard.security.passkeys.heading') }}
                            </h2>
                            <p class="text-sm text-muted">
                                {{ t('dashboard.security.passkeys.description') }}
                            </p>
                        </div>
                        <UButton icon="i-lucide-key" size="sm" @click="onAddPasskey">
                            {{ t('dashboard.security.passkeys.add') }}
                        </UButton>
                    </div>
                </template>

                <ul v-if="passkeys.length" class="divide-y divide-default -my-3">
                    <li
                        v-for="p in passkeys"
                        :key="p.id"
                        class="flex items-center justify-between py-3"
                    >
                        <div>
                            <p class="font-medium">
                                {{
                                    p.label ||
                                    p.deviceType ||
                                    t('dashboard.security.passkeys.labelFallback')
                                }}
                            </p>
                            <p class="text-xs text-muted">
                                {{
                                    p.lastUsedAt
                                        ? t('dashboard.security.passkeys.lastUsed', {
                                              date: new Date(p.lastUsedAt).toLocaleDateString(),
                                          })
                                        : t('dashboard.security.passkeys.neverUsed')
                                }}
                            </p>
                        </div>
                        <UButton
                            color="error"
                            variant="ghost"
                            icon="i-lucide-trash-2"
                            size="sm"
                            :aria-label="t('dashboard.security.passkeys.remove')"
                            @click="removePasskey(p.id)"
                        />
                    </li>
                </ul>
                <p v-else class="text-sm text-muted">
                    {{ t('dashboard.security.passkeys.empty') }}
                </p>
            </UCard>

            <UCard>
                <template #header>
                    <h2 class="text-base font-semibold">
                        {{ t('dashboard.security.sessions.heading') }}
                    </h2>
                    <p class="text-sm text-muted">
                        {{ t('dashboard.security.sessions.description') }}
                    </p>
                </template>

                <p v-if="!activeSessions.length" class="text-sm text-muted">
                    {{ t('dashboard.security.sessions.empty') }}
                </p>
                <ul v-else class="divide-y divide-default -my-3">
                    <li
                        v-for="s in activeSessions"
                        :key="s.id"
                        class="flex items-start justify-between gap-4 py-3"
                    >
                        <div class="min-w-0 flex-1">
                            <p class="text-sm font-medium">
                                {{ describeSession(s.userAgent) }}
                                <span
                                    v-if="s.current"
                                    class="ml-2 inline-flex rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary"
                                >
                                    {{ t('dashboard.security.sessions.current') }}
                                </span>
                            </p>
                            <p class="text-xs text-muted">
                                {{
                                    t('dashboard.security.sessions.lastSeen', {
                                        date: new Date(s.lastSeenAt).toLocaleString(),
                                    })
                                }}
                                <span v-if="s.ip" class="ml-2 font-mono">{{ s.ip }}</span>
                            </p>
                        </div>
                        <UButton
                            v-if="!s.current"
                            color="error"
                            variant="ghost"
                            icon="i-lucide-log-out"
                            size="sm"
                            :aria-label="t('dashboard.security.sessions.revoke')"
                            @click="revokeSession(s.id)"
                        />
                    </li>
                </ul>
            </UCard>

            <UCard v-if="totpAvailable">
                <template #header>
                    <h2 class="text-base font-semibold">
                        {{ t('dashboard.security.twoFactor.heading') }}
                    </h2>
                    <p class="text-sm text-muted">
                        {{ t('dashboard.security.twoFactor.description') }}
                    </p>
                </template>

                <div v-if="!totpStatus.enabled && !setup.otpauthUrl">
                    <UButton icon="i-lucide-shield-check" @click="startTotp">
                        {{ t('dashboard.security.twoFactor.enable') }}
                    </UButton>
                </div>

                <div v-else-if="setup.otpauthUrl" class="space-y-3">
                    <p class="text-sm">{{ t('dashboard.security.twoFactor.setupHint') }}</p>
                    <img
                        v-if="qrDataUrl"
                        :src="qrDataUrl"
                        :alt="t('dashboard.security.twoFactor.qrAlt')"
                        class="rounded border bg-white p-2"
                        width="200"
                        height="200"
                    />
                    <details class="text-xs">
                        <summary class="cursor-pointer text-muted">
                            {{ t('dashboard.security.twoFactor.copyUri') }}
                        </summary>
                        <code class="mt-1 block break-all rounded bg-elevated p-2">
                            {{ setup.otpauthUrl }}
                        </code>
                    </details>
                    <UFormField :label="t('dashboard.security.twoFactor.codePlaceholder')">
                        <UInput
                            v-model="setup.code"
                            :placeholder="t('dashboard.security.twoFactor.codePlaceholder')"
                            maxlength="6"
                            inputmode="numeric"
                            class="w-full max-w-xs font-mono"
                        />
                    </UFormField>
                    <UButton @click="verifyTotp">{{
                        t('dashboard.security.twoFactor.verify')
                    }}</UButton>
                </div>

                <div v-else-if="totpStatus.enabled" class="space-y-3">
                    <UAlert
                        color="success"
                        :title="t('dashboard.security.twoFactor.enabled')"
                        icon="i-lucide-circle-check"
                    />
                    <UFormField :label="t('dashboard.security.twoFactor.disableCodePlaceholder')">
                        <UInput
                            v-model="disableCode"
                            :placeholder="t('dashboard.security.twoFactor.disableCodePlaceholder')"
                            maxlength="6"
                            inputmode="numeric"
                            class="w-full max-w-xs font-mono"
                        />
                    </UFormField>
                    <UButton color="error" variant="soft" @click="disableTotp">
                        {{ t('dashboard.security.twoFactor.disable') }}
                    </UButton>
                </div>
            </UCard>

            <UCard v-if="totpAvailable && totpStatus.enabled">
                <template #header>
                    <h2 class="text-base font-semibold">
                        {{ t('dashboard.security.backupCodes.heading') }}
                    </h2>
                    <p class="text-sm text-muted">
                        {{ t('dashboard.security.backupCodes.description') }}
                    </p>
                </template>

                <div v-if="!revealedCodes.length" class="space-y-3">
                    <p class="text-sm">
                        <span v-if="backupCodes.unused > 0">
                            {{
                                t('dashboard.security.backupCodes.unused', {
                                    count: backupCodes.unused,
                                })
                            }}
                            <span v-if="backupCodes.unused < 3" class="text-error">
                                {{ t('dashboard.security.backupCodes.runningLow') }}
                            </span>
                        </span>
                        <span v-else class="text-muted">{{
                            t('dashboard.security.backupCodes.none')
                        }}</span>
                    </p>
                    <UButton
                        icon="i-lucide-refresh-cw"
                        variant="soft"
                        @click="onGenerateBackupCodes"
                    >
                        {{
                            backupCodes.unused > 0
                                ? t('dashboard.security.backupCodes.regenerate')
                                : t('dashboard.security.backupCodes.generate')
                        }}
                    </UButton>
                </div>

                <div v-else class="space-y-3">
                    <UAlert
                        color="warning"
                        :title="t('dashboard.security.backupCodes.saveTitle')"
                        icon="i-lucide-triangle-alert"
                        :description="t('dashboard.security.backupCodes.saveDescription')"
                    />
                    <ul
                        class="grid grid-cols-1 gap-2 rounded border border-default bg-elevated p-3 font-mono text-sm sm:grid-cols-2"
                    >
                        <li v-for="c in revealedCodes" :key="c">{{ c }}</li>
                    </ul>
                    <UButton variant="soft" @click="revealedCodes = []">
                        {{ t('dashboard.security.backupCodes.saved') }}
                    </UButton>
                </div>
            </UCard>

            <UCard v-if="auditAvailable">
                <template #header>
                    <h2 class="text-base font-semibold">
                        {{ t('dashboard.security.auditLog.heading') }}
                    </h2>
                    <p class="text-sm text-muted">
                        {{ t('dashboard.security.auditLog.description') }}
                    </p>
                </template>

                <p v-if="!auditEvents.length" class="text-sm text-muted">
                    {{ t('dashboard.security.auditLog.empty') }}
                </p>
                <ul v-else class="divide-y divide-default -my-3">
                    <li
                        v-for="ev in auditEvents"
                        :key="ev.id"
                        class="flex items-start justify-between gap-4 py-3"
                    >
                        <div class="min-w-0 flex-1">
                            <p class="text-sm font-medium">
                                {{ actionLabel(ev.action) }}
                                <span v-if="metaSubject(ev)" class="ml-1 font-normal text-muted">
                                    : {{ metaSubject(ev) }}
                                </span>
                            </p>
                            <p class="text-xs text-muted">
                                {{ new Date(ev.createdAt).toLocaleString() }}
                                <span v-if="ev.ip" class="ml-2 font-mono">{{ ev.ip }}</span>
                            </p>
                        </div>
                    </li>
                </ul>
            </UCard>

            <UCard v-if="!passkeysAvailable && !totpAvailable && !auditAvailable">
                <i18n-t keypath="dashboard.security.empty" tag="p" class="text-sm text-muted">
                    <template #extras><code>nuxt:auth-passkeys</code></template>
                    <template #twoFactor><code>nuxt:auth-2fa</code></template>
                    <template #addCommand><code>battlestack add &lt;feature&gt;</code></template>
                </i18n-t>
            </UCard>
        </ClientOnly>
    </div>
</template>

<script setup lang="ts">
import QRCode from 'qrcode'

interface Passkey {
    id: string
    label: string | null
    deviceType: string | null
    lastUsedAt: string | null
    createdAt: string
}

const { t, te } = useI18n()
const toast = useToast()
const twoFa = use2fa()

// Maps an audit-action enum (`user.login.success`, etc.) to a localised label under
// `dashboard.security.auditLog.actions.<slug>`, where slug replaces `.`/`-` with `_` (vue-i18n treats `.` as a path separator).
function actionLabel(action: string): string {
    const slug = action.replace(/[.-]/g, '_')
    const key = `dashboard.security.auditLog.actions.${slug}`
    return te(key) ? t(key) : action
}

// Extract a short subject from an audit row's metadata.
// Currently surfaces passkey labels (`Mobile`, `iPad`, etc) on login/registered/removed.
function metaSubject(ev: AuditRow): string | null {
    if (!ev.metadata) return null
    try {
        const meta = JSON.parse(ev.metadata) as Record<string, unknown>
        if (typeof meta.label === 'string' && meta.label) return meta.label
        if (typeof meta.deviceType === 'string' && meta.deviceType) return meta.deviceType
        return null
    } catch {
        return null
    }
}

function notifyError(e: unknown, fallback: string) {
    toast.add({ title: fallback, description: serverErrorMessage(e, fallback), color: 'error' })
}

const passkeysAvailable = ref(false)
const passkeys = ref<Passkey[]>([])

const totpAvailable = ref(false)
const totpStatus = ref<{ enabled: boolean; enabledAt: string | null }>({
    enabled: false,
    enabledAt: null,
})
const setup = reactive<{ otpauthUrl: string | null; code: string }>({
    otpauthUrl: null,
    code: '',
})
const qrDataUrl = ref<string>('')
const disableCode = ref('')
const backupCodes = ref<{ unused: number }>({ unused: 0 })
const revealedCodes = ref<string[]>([])

interface AuditRow {
    id: string
    action: string
    ip: string | null
    userAgent: string | null
    metadata: string | null
    createdAt: string
}
const auditAvailable = ref(false)
const auditEvents = ref<AuditRow[]>([])

interface SessionRow {
    id: string
    userAgent: string | null
    ip: string | null
    lastSeenAt: string
    createdAt: string
    expiresAt: string
    current: boolean
}
const activeSessions = ref<SessionRow[]>([])

// Cheap UA descriptor: "Mac · Chrome", "iPhone · Safari".
function describeSession(ua: string | null): string {
    if (!ua) return t('dashboard.security.sessions.unknown')
    const platform = /iPhone/.test(ua)
        ? 'iPhone'
        : /iPad/.test(ua)
          ? 'iPad'
          : /Android/.test(ua)
            ? 'Android'
            : /Mac/.test(ua)
              ? 'Mac'
              : /Windows/.test(ua)
                ? 'Windows'
                : /Linux/.test(ua)
                  ? 'Linux'
                  : 'Device'
    const browser = /Edg\//.test(ua)
        ? 'Edge'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Firefox\//.test(ua)
            ? 'Firefox'
            : /Safari\//.test(ua)
              ? 'Safari'
              : null
    return browser ? `${platform} · ${browser}` : platform
}

// Probe endpoints: 404 = feature not installed; any other status = installed.
async function detectFeatures() {
    try {
        passkeys.value = await $fetch<Passkey[]>('/api/auth/passkeys')
        passkeysAvailable.value = true
    } catch (e) {
        passkeysAvailable.value = (e as { statusCode?: number }).statusCode !== 404
    }

    try {
        totpStatus.value = await twoFa.status()
        totpAvailable.value = true
    } catch (e) {
        totpAvailable.value = (e as { statusCode?: number }).statusCode !== 404
    }

    if (totpAvailable.value && totpStatus.value.enabled) {
        try {
            backupCodes.value = await twoFa.backupCodesStatus()
        } catch {
            // older scaffolds: endpoint absent, leave `unused` at 0
        }
    }

    try {
        const res = await $fetch<{ rows: AuditRow[] }>('/api/audit/me')
        auditEvents.value = res.rows
        auditAvailable.value = true
    } catch (e) {
        auditAvailable.value = (e as { statusCode?: number }).statusCode !== 404
    }

    try {
        const res = await $fetch<{ rows: SessionRow[] }>('/api/auth/sessions')
        activeSessions.value = res.rows
    } catch {
        activeSessions.value = []
    }
}
await detectFeatures()

async function refreshSessions() {
    try {
        const res = await $fetch<{ rows: SessionRow[] }>('/api/auth/sessions')
        activeSessions.value = res.rows
    } catch {
        // ignore
    }
}

async function revokeSession(id: string) {
    try {
        await $fetch(`/api/auth/sessions/${id}`, { method: 'DELETE' })
        await refreshSessions()
        toast.add({ title: t('dashboard.security.sessions.revoked'), color: 'success' })
    } catch (e) {
        notifyError(e, t('dashboard.security.sessions.revokeError'))
    }
}

async function refreshPasskeys() {
    passkeys.value = await $fetch<Passkey[]>('/api/auth/passkeys')
}

// Best-guess label from navigator. WebAuthn doesn't expose the machine name
// (privacy), so we synthesise `<Platform> · <Browser>` from UA hints.
function defaultPasskeyLabel(): string {
    if (typeof navigator === 'undefined') return 'New passkey'
    const ua = navigator.userAgent
    const platform = /iPhone/.test(ua)
        ? 'iPhone'
        : /iPad/.test(ua)
          ? 'iPad'
          : /Android/.test(ua)
            ? 'Android'
            : /Mac/.test(ua)
              ? 'Mac'
              : /Windows/.test(ua)
                ? 'Windows'
                : /Linux/.test(ua)
                  ? 'Linux'
                  : 'Device'
    const browser = /Edg\//.test(ua)
        ? 'Edge'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Firefox\//.test(ua)
            ? 'Firefox'
            : /Safari\//.test(ua)
              ? 'Safari'
              : null
    return browser ? `${platform} · ${browser}` : platform
}

async function onAddPasskey() {
    try {
        const { addCredential } = usePasskey()
        const { user } = useAuth()
        const email = user.value?.email
        if (!email) return
        const suggested = defaultPasskeyLabel()
        const label = window.prompt(t('dashboard.security.passkeys.namePrompt'), suggested)
        if (label === null) return
        const trimmed = label.trim() || suggested
        await addCredential(email, trimmed)
        await refreshPasskeys()
        toast.add({ title: t('dashboard.security.passkeys.added'), color: 'success' })
    } catch (e) {
        notifyError(e, t('dashboard.security.passkeys.addError'))
    }
}

async function removePasskey(id: string) {
    try {
        await $fetch(`/api/auth/passkeys/${id}`, { method: 'DELETE' })
        await refreshPasskeys()
        toast.add({ title: t('dashboard.security.passkeys.removed'), color: 'success' })
    } catch (e) {
        notifyError(e, t('dashboard.security.passkeys.removeError'))
    }
}

async function startTotp() {
    try {
        const res = await twoFa.setup()
        setup.otpauthUrl = res.otpauthUrl
        setup.code = ''
        qrDataUrl.value = await QRCode.toDataURL(res.otpauthUrl, { width: 200, margin: 2 })
    } catch (e) {
        notifyError(e, t('dashboard.security.twoFactor.setupError'))
    }
}

async function verifyTotp() {
    try {
        const res = await twoFa.verify(setup.code)
        setup.otpauthUrl = null
        setup.code = ''
        totpStatus.value = await twoFa.status()
        // Auto-reveal codes inside the same flow: user must see + save them
        // before dismissing. Regenerate is still available later.
        revealedCodes.value = res.backupCodes
        backupCodes.value = { unused: res.backupCodes.length }
        toast.add({ title: t('dashboard.security.twoFactor.enabled'), color: 'success' })
    } catch (e) {
        notifyError(e, t('dashboard.security.twoFactor.verifyError'))
    }
}

async function disableTotp() {
    try {
        await twoFa.disable(disableCode.value)
        disableCode.value = ''
        totpStatus.value = await twoFa.status()
        backupCodes.value = { unused: 0 }
        revealedCodes.value = []
        toast.add({ title: t('dashboard.security.twoFactor.disabled'), color: 'success' })
    } catch (e) {
        notifyError(e, t('dashboard.security.twoFactor.disableError'))
    }
}

async function onGenerateBackupCodes() {
    try {
        const res = await twoFa.generateBackupCodes()
        revealedCodes.value = res.codes
        backupCodes.value = { unused: res.codes.length }
        toast.add({ title: t('dashboard.security.backupCodes.generated'), color: 'success' })
    } catch (e) {
        notifyError(e, t('dashboard.security.backupCodes.generateError'))
    }
}
</script>
