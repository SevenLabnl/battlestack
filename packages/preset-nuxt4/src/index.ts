import { defineBattlestackPlugin } from '@battlestack/core'
import { dockerFeature } from './features/docker.js'
import { envFeature } from './features/env.js'
import { formattingFeature } from './features/formatting.js'
import { githubFeature } from './features/github.js'
import { installFeature } from './features/install.js'
import { packagePolicyFeature } from './features/package-policy.js'
import { playwrightFeature } from './features/playwright.js'
import { securityFeature } from './features/security.js'
import { aiToolConfigFeature } from './features/ai-tool-config.js'
import { ciFeature } from './features/ci.js'
import { namingFeature } from './features/naming.js'
import { gitignoreFeature } from './features/gitignore.js'
import { essentialsFeature } from './features/essentials.js'
import { healthFeature } from './features/health.js'
import { finalizeFeature } from './features/finalize.js'
import { scaffoldFeature } from './features/scaffold.js'
import { databaseFeature } from './features/database.js'
import { authFeature } from './features/auth.js'
import { authVerificationFeature } from './features/auth-verification.js'
import { authRecoveryFeature } from './features/auth-recovery.js'
import { auth2faFeature } from './features/auth-2fa.js'
import { authPasskeysFeature } from './features/auth-passkeys.js'
import { oauthFeature } from './features/oauth.js'
import { userAdminFeature } from './features/user-admin.js'
import { auditLogFeature } from './features/audit-log.js'
import { nuxtUiFeature } from './features/nuxt-ui.js'
import { piniaFeature } from './features/pinia.js'
import { landingShellFeature } from './features/landing-shell.js'
import { dashboardShellFeature } from './features/dashboard-shell.js'
import { i18nFeature } from './features/i18n.js'
import { pwaFeature } from './features/pwa.js'
import { vitestFeature } from './features/vitest.js'
import { docsFeature } from './features/docs.js'
import { mastraFeature } from './features/mastra.js'
import { ragFeature } from './features/rag.js'
import { promptsFeature } from './features/prompts.js'
import { chatFeature } from './features/chat.js'
import { storageFeature } from './features/storage.js'
import { redisFeature } from './features/redis.js'
import { registerNuxtTemplates } from './templates.js'
import { createCommand } from './commands/create.js'
import { initCommand } from './commands/init.js'

// Re-exported for `packages/cli`.
export { applyEnv, collectEnvForFeature } from './features/env.js'
export { formatProject } from './features/install.js'

/** The shared cross-cutting features, the Nuxt-framework features, and the three templates. */

export default defineBattlestackPlugin({
    name: '@battlestack/preset-nuxt4',
    apiVersion: 1,
    // Explicit, pinning every fqid to `nuxt4:*` rather than deriving it from the package scope.
    namespace: 'nuxt4',
    register(battlestack) {
        // Gates `battlestack add`: ids a project may carry, not what this package registers.
        battlestack.addFramework({
            id: 'nuxt4',
            label: 'Nuxt 4',
            supportedFeatures: [
                'nuxt4:scaffold',
                'nuxt4:gitignore',
                'nuxt4:naming',
                'nuxt4:essentials',
                'nuxt4:nuxt-ui',
                'nuxt4:landing-shell',
                'nuxt4:vitest',
                'nuxt4:i18n',
                'nuxt4:database',
                'nuxt4:auth',
                'nuxt4:auth-passkeys',
                'nuxt4:auth-recovery',
                'nuxt4:auth-2fa',
                'nuxt4:oauth',
                'nuxt4:dashboard-shell',
                'nuxt4:mastra',
                'nuxt4:chat',
                'nuxt4:health',
                'nuxt4:pinia',
                'nuxt4:storage',
                'nuxt4:redis',
                'nuxt4:rag',
                'nuxt4:prompts',
                'nuxt4:pwa',
                'nuxt4:fontawesome',
                'nuxt4:audit-log',
                'nuxt4:user-admin',
                'nuxt4:docs',
                'nuxt4:finalize',
                'shared:formatting',
                'shared:package-policy',
                'shared:docker',
                'shared:github',
                'shared:security',
                'shared:ai-tool-config',
                'shared:env',
                'shared:install',
                'shared:ci',
                'shared:playwright',
            ],
        })

        battlestack.addFeature(dockerFeature)
        battlestack.addFeature(envFeature)
        battlestack.addFeature(formattingFeature)
        battlestack.addFeature(githubFeature)
        battlestack.addFeature(installFeature)
        battlestack.addFeature(packagePolicyFeature)
        battlestack.addFeature(playwrightFeature)
        battlestack.addFeature(securityFeature)
        battlestack.addFeature(aiToolConfigFeature)
        battlestack.addFeature(ciFeature)
        // Nuxt-framework features. Stage order, not registration order, decides execution.
        battlestack.addFeature(scaffoldFeature)
        battlestack.addFeature(namingFeature)
        battlestack.addFeature(gitignoreFeature)
        battlestack.addFeature(essentialsFeature)
        battlestack.addFeature(healthFeature)
        battlestack.addFeature(databaseFeature)
        battlestack.addFeature(authFeature)
        battlestack.addFeature(authVerificationFeature)
        battlestack.addFeature(authRecoveryFeature)
        battlestack.addFeature(auth2faFeature)
        battlestack.addFeature(authPasskeysFeature)
        battlestack.addFeature(oauthFeature)
        battlestack.addFeature(userAdminFeature)
        battlestack.addFeature(auditLogFeature)
        battlestack.addFeature(nuxtUiFeature)
        battlestack.addFeature(piniaFeature)
        battlestack.addFeature(landingShellFeature)
        battlestack.addFeature(dashboardShellFeature)
        battlestack.addFeature(i18nFeature)
        battlestack.addFeature(pwaFeature)
        battlestack.addFeature(vitestFeature)
        battlestack.addFeature(docsFeature)
        battlestack.addFeature(mastraFeature)
        battlestack.addFeature(ragFeature)
        battlestack.addFeature(promptsFeature)
        battlestack.addFeature(chatFeature)
        battlestack.addFeature(storageFeature)
        battlestack.addFeature(redisFeature)
        battlestack.addFeature(finalizeFeature)

        // Templates carry only public features.
        registerNuxtTemplates(battlestack)

        // `create`/`init` are plugin-contributed, not CLI built-ins.
        battlestack.addCommand({
            id: 'create',
            usage: 'create [name] [template]',
            description: 'Scaffold a new project from a template',
            honorsDryRun: true,
            run: createCommand,
        })
        battlestack.addCommand({
            id: 'init',
            usage: 'init [template]',
            description: 'Adopt the current directory into project mode',
            honorsDryRun: true,
            run: initCommand,
        })

        battlestack.addDeployTarget({ id: 'docker', label: 'Docker Compose (self-hosted)' })
        // Features resolve their own template roots via core's `templatesDir` helper.
    },
})
