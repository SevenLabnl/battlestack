import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'
import { patchNuxtConfig } from '../utils/nuxt-config.js'
import type { EnvVar } from '@battlestack/core'
import type { Feature } from '@battlestack/core'
import { STAGE } from '@battlestack/core'

/** TOTP-based two-factor auth. Secrets encrypted at rest with AES-256-GCM via `NUXT_TOTP_ENCRYPTION_KEY`. */
export const auth2faFeature: Feature = {
    id: 'nuxt4:auth-2fa',
    // 1.2.1: re-emitted for the now-async `rateLimit()`.
    version: '1.2.1',
    label: 'Two-factor auth (TOTP)',
    description: 'Authenticator-app 2FA; TOTP secrets encrypted at rest.',
    frameworks: ['nuxt4'],
    stage: STAGE.AUTH_EXTRAS,
    requires: ['nuxt4:auth'],
    failureIsNonFatal: true,

    collectDeps() {
        // `qrcode` is declared by `dashboard-shell`. This feature owns only `otplib`.
        return { prod: ['otplib'] }
    },

    collectEnv(): EnvVar[] {
        return [
            {
                key: 'NUXT_TOTP_ENCRYPTION_KEY',
                generate: { bytes: 32, encoding: 'hex' },
                group: 'Two-factor',
                secret: true,
                description:
                    'AES-256-GCM key for TOTP secrets at rest. Exactly 64 hex chars (32 bytes). NEVER commit. Rotate via re-setup.',
            },
            {
                key: 'NUXT_TOTP_STRICT',
                value: 'false',
                group: 'Two-factor',
                description:
                    'Strict TOTP window. false (default) = ±60s tolerance so a code typed at the last second still verifies after submit latency/clock skew. Set true to tighten to ±30s.',
            },
        ]
    },

    collectDocs() {
        return [
            {
                heading: 'Two-factor (TOTP)',
                body: [
                    'TOTP-based 2FA built on `otplib`. Secrets are encrypted at rest with AES-256-GCM (`server/utils/totp.ts`) using the project-scoped `NUXT_TOTP_ENCRYPTION_KEY`.',
                    '',
                    '- `GET /api/auth/2fa/status`: returns `{ enabled, enabledAt }`',
                    '- `POST /api/auth/2fa/setup`: returns `{ secret, otpauthUrl }` (show as QR)',
                    '- `POST /api/auth/2fa/verify`: body `{ code }` to flip enabled=true',
                    '- `POST /api/auth/2fa/disable`: body `{ code }` (current code required to deauthorise)',
                    '- Composable: `use2fa()` (the single client for all the above; `dashboard-shell/security.vue` uses it)',
                    '',
                    'Verification window: codes are accepted within ±60s of now by default (`epochTolerance` in `server/utils/totp.ts`), so a code entered at the last second survives submit latency + clock skew. Set `NUXT_TOTP_STRICT=true` to tighten to ±30s.',
                    '',
                    'Backup codes (single-use recovery, when the authenticator device is lost):',
                    '- `GET /api/auth/2fa/backup-codes`: returns `{ unused: number }` (count only, since plaintext is generate-time-only)',
                    '- `POST /api/auth/2fa/backup-codes/generate`: wipes existing codes, issues 10 new ones. Plaintext returned ONCE. Requires 2FA already enabled.',
                    '- `POST /api/auth/2fa/backup-codes/redeem`: body `{ code }`. Atomic single-consumption, so concurrent redeems on the same code can\'t both win.',
                    '',
                    'Step-up challenge during sign-in is **not** in this version. Add a `pending2fa` session marker + wire backup-codes/redeem into the signin flow when you need it.',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute(ctx) {
        await emitTemplate(ctx, 'nuxt4:auth-2fa', import.meta.url, 'auth-2fa')
        await registerRuntimeConfig(ctx.projectDir)
    },

    async update(ctx, prev) {
        const result = await emitTemplateUpdate(ctx, 'nuxt4:auth-2fa', import.meta.url, 'auth-2fa', prev)
        await registerRuntimeConfig(ctx.projectDir)
        return result
    },
}

// Declares the keys `NUXT_TOTP_*` binds onto. `totpStrict` defaults to `false` for boolean coercion.
async function registerRuntimeConfig(projectDir: string): Promise<void> {
    await patchNuxtConfig(projectDir, (c) =>
        c.mergeRuntimeConfig({ totpEncryptionKey: '', totpStrict: false }),
    )
}
