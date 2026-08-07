import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'
import { patchNuxtConfig } from '../utils/nuxt-config.js'
import type { Feature } from '@battlestack/core'
import { STAGE } from '@battlestack/core'

/** Forgot-password and reset-password. Tokens sha256-hashed at rest. */
export const authRecoveryFeature: Feature = {
    id: 'nuxt4:auth-recovery',
    // 1.1.2: re-emitted for the now-async `rateLimit()`.
    version: '1.1.2',
    label: 'Password recovery',
    description: 'Forgot-password and reset flows with one-time, hashed tokens.',
    frameworks: ['nuxt4'],
    stage: STAGE.AUTH_EXTRAS,
    requires: ['nuxt4:auth'],
    failureIsNonFatal: true,

    collectDocs() {
        return [
            {
                heading: 'Auth recovery',
                body: [
                    'Password-reset flow. Tokens are sha256-hashed at rest; plaintext lives only in email links. Recovery emails go through `server/utils/email.ts`: set `NUXT_SMTP_*` in `.env` or fall back to logging.',
                    '',
                    '- `POST /api/auth/forgot-password` (public, rate-limited)',
                    '- `POST /api/auth/reset-password` (one-time token, rotates password)',
                    '- Pages: `/forgot-password`, `/reset-password`',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute(ctx) {
        await emitTemplate(ctx, 'nuxt4:auth-recovery', import.meta.url, 'auth-recovery')
        await flagRecoveryEnabled(ctx.projectDir)
    },

    async update(ctx, prev) {
        const result = await emitTemplateUpdate(ctx, 'nuxt4:auth-recovery', import.meta.url, 'auth-recovery', prev)
        await flagRecoveryEnabled(ctx.projectDir)
        return result
    },
}

// Public runtime flag gating login.vue's "Forgot password?" link.
async function flagRecoveryEnabled(projectDir: string): Promise<void> {
    await patchNuxtConfig(projectDir, (c) => c.mergeRuntimePublic({ authRecovery: true }))
}
