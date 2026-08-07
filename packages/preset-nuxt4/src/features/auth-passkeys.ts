import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'
import { patchNuxtConfig } from '../utils/nuxt-config.js'
import type { EnvVar } from '@battlestack/core'
import type { Feature } from '@battlestack/core'
import { STAGE } from '@battlestack/core'

/** Passkeys (WebAuthn) on `nuxt-auth-utils`. Requires `auth.webAuthn = true` in nuxt.config. */
export const authPasskeysFeature: Feature = {
    id: 'nuxt4:auth-passkeys',
    version: '1.1.2',
    label: 'Passkeys (WebAuthn)',
    description: 'Passwordless login and registration via platform passkeys.',
    frameworks: ['nuxt4'],
    stage: STAGE.AUTH_EXTRAS,
    requires: ['nuxt4:auth'],
    failureIsNonFatal: true,

    collectDeps() {
        return {
            prod: ['@simplewebauthn/server@^11', '@simplewebauthn/browser@^11'],
        }
    },

    collectEnv(): EnvVar[] {
        return [
            {
                key: 'NUXT_WEBAUTHN_RP_ID',
                example: 'localhost',
                group: 'WebAuthn',
                description: 'Relying-party id. Hostname only (no scheme/port). Pin in prod.',
            },
            {
                key: 'NUXT_WEBAUTHN_RP_NAME',
                example: 'My App',
                group: 'WebAuthn',
                description: 'User-visible name shown by the OS during passkey prompts.',
            },
        ]
    },

    collectDocs() {
        return [
            {
                heading: 'Passkeys',
                body: [
                    'Passkey (WebAuthn) registration + authentication. Built on nuxt-auth-utils\' built-in handlers; we plug in challenge + credential storage via Drizzle.',
                    '',
                    '- Register: `POST /api/auth/passkey/register` (after sign-in)',
                    '- Sign-in: `POST /api/auth/passkey/authenticate`',
                    '- List: `GET /api/auth/passkeys`',
                    '- Revoke: `DELETE /api/auth/passkeys/:id`',
                    '- Composable: `usePasskey()` exposes `signUp`, `signIn`, `addCredential`',
                    '',
                    'Pin `NUXT_WEBAUTHN_RP_ID` to your production domain (hostname only, no scheme/port). 2FA via TOTP is on the roadmap; not part of this feature yet.',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute(ctx) {
        await emitTemplate(ctx, 'nuxt4:auth-passkeys', import.meta.url, 'auth-passkeys')
        await enableWebAuthn(ctx.projectDir)
    },

    async update(ctx, prev) {
        const report = await emitTemplateUpdate(ctx, 'nuxt4:auth-passkeys', import.meta.url, 'auth-passkeys', prev)
        await enableWebAuthn(ctx.projectDir)
        return report
    },
}

// `auth.webAuthn = true` registers the `defineWebAuthn*EventHandler` auto-imports.
// `runtimeConfig.public.authPasskeys` toggles login.vue's passkey button.
async function enableWebAuthn(projectDir: string): Promise<void> {
    await patchNuxtConfig(projectDir, (c) => {
        c.mergeRuntimePublic({ authPasskeys: true })
        c.mutate((config) => {
            config.auth ||= {}
            config.auth.webAuthn = true
        })
    })
}
