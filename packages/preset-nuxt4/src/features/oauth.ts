import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'
import { patchNuxtConfig } from '../utils/nuxt-config.js'
import type { EnvVar } from '@battlestack/core'
import type { Feature } from '@battlestack/core'
import { STAGE } from '@battlestack/core'

/** GitHub + Google OAuth via `nuxt-auth-utils`. */
export const oauthFeature: Feature = {
    id: 'nuxt4:oauth',
    version: '1.0.3',
    label: 'OAuth (GitHub + Google)',
    description: 'Social sign-in via GitHub and Google OAuth apps.',
    frameworks: ['nuxt4'],
    stage: STAGE.AUTH_EXTRAS,
    requires: ['nuxt4:auth'],
    failureIsNonFatal: true,

    collectEnv(): EnvVar[] {
        return [
            {
                key: 'OAUTH_GITHUB_CLIENT_ID',
                example: 'replace-me',
                group: 'OAuth',
                description: 'GitHub OAuth App client id (https://github.com/settings/developers).',
            },
            {
                key: 'OAUTH_GITHUB_CLIENT_SECRET',
                example: 'replace-me',
                group: 'OAuth',
                secret: true,
            },
            {
                key: 'OAUTH_GOOGLE_CLIENT_ID',
                example: 'replace-me',
                group: 'OAuth',
                description: 'Google OAuth client id (https://console.cloud.google.com/apis/credentials).',
            },
            {
                key: 'OAUTH_GOOGLE_CLIENT_SECRET',
                example: 'replace-me',
                group: 'OAuth',
                secret: true,
            },
        ]
    },

    collectDocs() {
        return [
            {
                heading: 'OAuth (GitHub + Google)',
                body: [
                    'Sign-in via GitHub or Google. Set the four `OAUTH_<provider>_CLIENT_{ID,SECRET}` vars in `.env` after creating OAuth apps in each provider\'s console. The redirect URI is `<NUXT_PUBLIC_APP_URL>/api/auth/oauth/<provider>`.',
                    '',
                    'First sign-in creates a local `users` row with `passwordHash: \'\'` (a sentinel: no password login possible). Subsequent OAuth sign-ins from the same account hit the existing row via `(provider, providerUserId)` link.',
                    '',
                    'Disable a provider button without removing the feature: edit `nuxt.config.ts` and set `runtimeConfig.public.oauthProviders.<provider> = false`.',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute(ctx) {
        await emitTemplate(ctx, 'nuxt4:oauth', import.meta.url, 'oauth')
        await flagOauthEnabled(ctx.projectDir)
    },

    async update(ctx, prev) {
        const result = await emitTemplateUpdate(ctx, 'nuxt4:oauth', import.meta.url, 'oauth', prev)
        await flagOauthEnabled(ctx.projectDir)
        return result
    },
}

async function flagOauthEnabled(projectDir: string): Promise<void> {
    await patchNuxtConfig(projectDir, (c) =>
        c.mergeRuntimePublic({
            oauthProviders: { github: true, google: true },
        }),
    )
}
