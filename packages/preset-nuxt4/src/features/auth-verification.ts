import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'
import { patchNuxtConfig } from '../utils/nuxt-config.js'
import type { EnvVar } from '@battlestack/core'
import type { Feature } from '@battlestack/core'
import { STAGE } from '@battlestack/core'

/** Email verification: a signup token verified via a one-time link, optionally blocking login. */
export const authVerificationFeature: Feature = {
    id: 'nuxt4:auth-verification',
    // 1.0.2: re-emitted for the now-async `rateLimit()`.
    version: '1.0.2',
    label: 'Email verification',
    frameworks: ['nuxt4'],
    stage: STAGE.AUTH_EXTRAS,
    requires: ['nuxt4:auth'],
    failureIsNonFatal: true,

    collectEnv(): EnvVar[] {
        return [
            {
                key: 'NUXT_PUBLIC_REQUIRE_EMAIL_VERIFICATION',
                value: 'false',
                group: 'Auth',
                description:
                    'When true, login is blocked until the user verifies their email (a user_email_verified row exists). false (default) keeps verification optional: the email is still sent on signup, but unverified users can sign in.',
            },
        ]
    },

    collectDocs() {
        return [
            {
                heading: 'Email verification',
                body: [
                    'Issues a verification token on signup (`server/utils/email-verification.ts#issueVerificationEmail`, called by `nuxt4:auth`\'s signup when this feature is installed) and verifies it via a one-time link. Tokens are sha256-hashed at rest; plaintext lives only in the email link.',
                    '',
                    '- `POST /api/auth/verify-email` (one-time token → writes `user_email_verified`)',
                    '- `POST /api/auth/resend-verification` (public, email-based, rate-limited; always returns ok, sends only if an unverified user matches)',
                    '- Page: `/verify-email`',
                    '',
                    'Enforcement: set `NUXT_PUBLIC_REQUIRE_EMAIL_VERIFICATION=true` to block login until the email is verified. Default false: the email is still sent, but unverified users can sign in. When on, `login.post.ts` returns 403 `{ code: EMAIL_NOT_VERIFIED }` and the login page offers a resend.',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute(ctx) {
        await emitTemplate(ctx, 'nuxt4:auth-verification', import.meta.url, 'auth-verification')
        await flagVerification(ctx.projectDir)
    },

    async update(ctx, prev) {
        const result = await emitTemplateUpdate(
            ctx,
            'nuxt4:auth-verification',
            import.meta.url,
            'auth-verification',
            prev,
        )
        await flagVerification(ctx.projectDir)
        return result
    },
}

// `authVerification` enables the signup hook and the login resend link.
// `requireEmailVerification` gates login, and is written only when absent.
async function flagVerification(projectDir: string): Promise<void> {
    await patchNuxtConfig(projectDir, (c) => {
        c.mergeRuntimePublic({ authVerification: true })
        c.setRuntimePublicDefault('requireEmailVerification', false)
    })
}
