import type { BattlestackPluginContext } from '@battlestack/core'

/**
 * No template hardcodes a private deploy feature. A private plugin adds one via `extendTemplate`.
 *
 * `nuxt4:sevenlab-ui` is optional-but-default-on in all three templates, not required.
 * Required would be wrong while `@sevenlab/ui-default` is not on a registry yet: this
 * preset is published, so a required feature would make every `battlestack create`
 * fail at install time. Default-on because it is the house standard, and a SevenLab
 * project that starts without it is a project that diverges. Nothing else depends on
 * it, so switching it off leaves a working Nuxt UI + Tailwind app rather than a broken
 * one.
 *
 * Revisit once the package is published: required is the better default then, and the
 * only reason it is not required today is distribution, not design.
 */
export function registerNuxtTemplates(battlestack: BattlestackPluginContext): void {
    battlestack.addTemplate({
        id: 'nuxt4-ai',
        label: 'Nuxt (AI app)',
        description: 'Full stack + Mastra agents + HTTP streaming chat + Docker. RAG opt-in.',
        framework: 'nuxt4',
        requiredFeatures: [
            'nuxt4:scaffold',
            'nuxt4:gitignore',
            'shared:formatting',
            'shared:package-policy',
            'nuxt4:naming',
            'nuxt4:essentials',
            'nuxt4:nuxt-ui',
            'nuxt4:landing-shell',
            'nuxt4:vitest',
            'nuxt4:i18n',
            'nuxt4:database',
            'nuxt4:auth',
            'nuxt4:dashboard-shell',
            'nuxt4:mastra',
            'nuxt4:chat',
            'nuxt4:health',
            'nuxt4:pinia',
            'shared:docker',
            'shared:github',
            'shared:security',
            'shared:ai-tool-config',
            'nuxt4:docs',
            'shared:env',
            'shared:install',
            'nuxt4:finalize',
        ],
        optionalFeatures: [
            'nuxt4:sevenlab-ui',
            'nuxt4:audit-log',
            'nuxt4:user-admin',
            'nuxt4:auth-passkeys',
            'nuxt4:auth-recovery',
            'nuxt4:auth-2fa',
            'nuxt4:oauth',
            'nuxt4:storage',
            'nuxt4:redis',
            'nuxt4:rag',
            'nuxt4:prompts',
            'nuxt4:pwa',
            'shared:ci',
            'shared:playwright',
        ],
        defaultEnabledOptional: [
            'nuxt4:sevenlab-ui',
            'nuxt4:pwa',
            'shared:ci',
            'nuxt4:audit-log',
            'nuxt4:user-admin',
            'nuxt4:auth-recovery',
            'nuxt4:auth-2fa',
            'nuxt4:auth-passkeys',
            'nuxt4:storage',
            'nuxt4:rag',
            'nuxt4:prompts',
            'shared:playwright',
            // `nuxt4:redis` is offered but not default-on.
        ],
    })

    battlestack.addTemplate({
        id: 'nuxt4-fullstack',
        label: 'Nuxt (full stack)',
        description: 'Nuxt + UI + i18n + Postgres + Drizzle + custom auth + Mastra + Docker.',
        framework: 'nuxt4',
        requiredFeatures: [
            'nuxt4:scaffold',
            'nuxt4:gitignore',
            'shared:formatting',
            'shared:package-policy',
            'nuxt4:naming',
            'nuxt4:essentials',
            'nuxt4:nuxt-ui',
            'nuxt4:landing-shell',
            'nuxt4:vitest',
            'nuxt4:i18n',
            'nuxt4:database',
            'nuxt4:auth',
            'nuxt4:dashboard-shell',
            'nuxt4:mastra',
            'nuxt4:health',
            'nuxt4:pinia',
            'shared:docker',
            'shared:github',
            'shared:security',
            'shared:ai-tool-config',
            'nuxt4:docs',
            'shared:env',
            'shared:install',
            'nuxt4:finalize',
        ],
        optionalFeatures: [
            'nuxt4:sevenlab-ui',
            'nuxt4:audit-log',
            'nuxt4:user-admin',
            'nuxt4:auth-passkeys',
            'nuxt4:auth-recovery',
            'nuxt4:auth-2fa',
            'nuxt4:oauth',
            'nuxt4:storage',
            'nuxt4:chat',
            'nuxt4:redis',
            'nuxt4:rag',
            'nuxt4:prompts',
            'nuxt4:pwa',
            'shared:ci',
            'shared:playwright',
        ],
        defaultEnabledOptional: [
            'nuxt4:sevenlab-ui',
            'nuxt4:pwa',
            'shared:ci',
            'nuxt4:audit-log',
            'nuxt4:user-admin',
            'nuxt4:auth-recovery',
            'nuxt4:auth-2fa',
            'nuxt4:auth-passkeys',
            'nuxt4:storage',
            'shared:playwright',
            // `nuxt4:redis` is offered but not default-on.
        ],
    })

    battlestack.addTemplate({
        id: 'nuxt4-minimal',
        label: 'Nuxt (minimal)',
        description: 'Nuxt 4 + UI v4 + Tailwind v4 only. No backend, no auth.',
        framework: 'nuxt4',
        requiredFeatures: [
            'nuxt4:scaffold',
            'nuxt4:gitignore',
            'shared:formatting',
            'shared:package-policy',
            'nuxt4:naming',
            'nuxt4:essentials',
            'nuxt4:nuxt-ui',
            'nuxt4:vitest',
            'nuxt4:i18n',
            'nuxt4:health',
            'nuxt4:pinia',
            'shared:docker',
            'shared:github',
            'shared:security',
            'shared:ai-tool-config',
            'nuxt4:docs',
            'shared:env',
            'shared:install',
            'nuxt4:finalize',
        ],
        optionalFeatures: [
            'nuxt4:sevenlab-ui',
            'nuxt4:landing-shell',
            'nuxt4:pwa',
            'shared:ci',
            'shared:playwright',
        ],
        defaultEnabledOptional: [
            'nuxt4:sevenlab-ui',
            'nuxt4:landing-shell',
            'nuxt4:pwa',
            'shared:ci',
            'shared:playwright',
        ],
    })
}
