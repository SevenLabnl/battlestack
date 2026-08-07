import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { applyPlugin, defineBattlestackPlugin, finalizeRegistries, type LoadedPlugin } from '../src/plugin.js'
import { BattlestackRegistries } from '../src/registry.js'
import type { Feature, Template } from '../src/types.js'

/**
 * The *actual* production id lists thrown at `finalizeRegistries`, copied rather than
 * imported because core stays dependency-free. Dropped `nuxt4:*` warnings are expected.
 */

// Verbatim from packages/preset-nuxt/src/index.ts `register()`.
const REGISTERED_PUBLIC_FEATURE_IDS = [
    'shared:docker',
    'shared:env',
    'shared:formatting',
    'shared:github',
    'shared:install',
    'shared:package-policy',
    'shared:playwright',
    'shared:security',
    'shared:ai-tool-config',
    'shared:ci',
]

// Verbatim from packages/preset-nuxt/src/templates.ts `registerNuxtTemplates`.
const NUXT_AI_REQUIRED = [
    'nuxt4:scaffold', 'nuxt4:gitignore', 'shared:formatting', 'shared:package-policy', 'nuxt4:naming',
    'nuxt4:essentials', 'nuxt4:nuxt-ui', 'nuxt4:landing-shell', 'nuxt4:vitest', 'nuxt4:i18n', 'nuxt4:database',
    'nuxt4:auth', 'nuxt4:dashboard-shell', 'nuxt4:mastra', 'nuxt4:chat', 'nuxt4:health', 'nuxt4:pinia',
    'shared:docker', 'shared:github', 'shared:security', 'shared:ai-tool-config', 'nuxt4:docs',
    'shared:env', 'shared:install', 'nuxt4:finalize',
]
const NUXT_AI_OPTIONAL = [
    'nuxt4:audit-log', 'nuxt4:user-admin', 'nuxt4:auth-passkeys', 'nuxt4:auth-recovery', 'nuxt4:auth-2fa',
    'nuxt4:oauth', 'nuxt4:storage', 'nuxt4:rag', 'nuxt4:prompts', 'nuxt4:pwa',
    'shared:ci', 'shared:playwright',
]
const NUXT_AI_DEFAULT_ENABLED = [
    'nuxt4:pwa', 'shared:ci', 'nuxt4:audit-log', 'nuxt4:user-admin', 'nuxt4:auth-recovery', 'nuxt4:auth-2fa',
    'nuxt4:auth-passkeys', 'nuxt4:storage', 'nuxt4:rag', 'nuxt4:prompts', 'shared:playwright',
]

const NUXT_FULLSTACK_REQUIRED = [
    'nuxt4:scaffold', 'nuxt4:gitignore', 'shared:formatting', 'shared:package-policy', 'nuxt4:naming',
    'nuxt4:essentials', 'nuxt4:nuxt-ui', 'nuxt4:landing-shell', 'nuxt4:vitest', 'nuxt4:i18n', 'nuxt4:database',
    'nuxt4:auth', 'nuxt4:dashboard-shell', 'nuxt4:mastra', 'nuxt4:health', 'nuxt4:pinia', 'shared:docker',
    'shared:github', 'shared:security', 'shared:ai-tool-config', 'nuxt4:docs', 'shared:env',
    'shared:install', 'nuxt4:finalize',
]
const NUXT_FULLSTACK_OPTIONAL = [
    'nuxt4:audit-log', 'nuxt4:user-admin', 'nuxt4:auth-passkeys', 'nuxt4:auth-recovery', 'nuxt4:auth-2fa',
    'nuxt4:oauth', 'nuxt4:storage', 'nuxt4:chat', 'nuxt4:rag', 'nuxt4:prompts', 'nuxt4:pwa',
    'shared:ci', 'shared:playwright',
]
const NUXT_FULLSTACK_DEFAULT_ENABLED = [
    'nuxt4:pwa', 'shared:ci', 'nuxt4:audit-log', 'nuxt4:user-admin', 'nuxt4:auth-recovery', 'nuxt4:auth-2fa',
    'nuxt4:auth-passkeys', 'nuxt4:storage', 'shared:playwright',
]

const NUXT_MINIMAL_REQUIRED = [
    'nuxt4:scaffold', 'nuxt4:gitignore', 'shared:formatting', 'shared:package-policy', 'nuxt4:naming',
    'nuxt4:essentials', 'nuxt4:nuxt-ui', 'nuxt4:vitest', 'nuxt4:i18n', 'nuxt4:health', 'nuxt4:pinia',
    'shared:docker', 'shared:github', 'shared:security', 'shared:ai-tool-config', 'nuxt4:docs',
    'shared:env', 'shared:install', 'nuxt4:finalize',
]
const NUXT_MINIMAL_OPTIONAL = [
    'nuxt4:landing-shell', 'nuxt4:pwa', 'shared:ci', 'shared:playwright',
]
const NUXT_MINIMAL_DEFAULT_ENABLED = [
    'nuxt4:landing-shell', 'nuxt4:pwa', 'shared:ci', 'shared:playwright',
]

function feature(id: string): Feature {
    return { id, label: id, stage: 'FINALIZE', version: '1.0.0', execute: async () => {} }
}

function template(id: string, required: string[], optional: string[], defaultEnabled: string[]): Template {
    return {
        id, label: id, framework: 'nuxt', requiredFeatures: [...required], optionalFeatures: [...optional],
        defaultEnabledOptional: [...defaultEnabled],
    }
}

/** Mirrors `canonicalize()` in `../src/plugin.ts`: dedupe, preserve first-seen order, drop unresolved. */
function expectedResolved(ids: string[], registered: Set<string>, ns: string): string[] {
    return [...new Set(ids.filter((id) => registered.has(id)).map((id) => `${ns}:${id}`))]
}

function loadRealFeatureSet() {
    const registries = new BattlestackRegistries()
    const loaded: LoadedPlugin[] = []

    loaded.push(applyPlugin(defineBattlestackPlugin({
        name: '@battlestack/preset-nuxt',
        apiVersion: 1,
        register(battlestack) {
            for (const id of REGISTERED_PUBLIC_FEATURE_IDS) battlestack.addFeature(feature(id))
            battlestack.addTemplate(template('nuxt4-ai', NUXT_AI_REQUIRED, NUXT_AI_OPTIONAL, NUXT_AI_DEFAULT_ENABLED))
            battlestack.addTemplate(
                template('nuxt4-fullstack', NUXT_FULLSTACK_REQUIRED, NUXT_FULLSTACK_OPTIONAL, NUXT_FULLSTACK_DEFAULT_ENABLED),
            )
            battlestack.addTemplate(
                template('nuxt4-minimal', NUXT_MINIMAL_REQUIRED, NUXT_MINIMAL_OPTIONAL, NUXT_MINIMAL_DEFAULT_ENABLED),
            )
        },
    }), 'bundled', registries))

    // Stand-in for the real internal plugin: same extendTemplate shape, neutral names.
    loaded.push(applyPlugin(defineBattlestackPlugin({
        name: '@acme/battlestack-plugin',
        apiVersion: 1,
        register(battlestack) {
            battlestack.addFeature(feature('shared:deploy'))
            battlestack.extendTemplate({ templateId: 'nuxt4-fullstack', addFeatures: ['shared:deploy'] })
        },
    }), 'store', registries))

    const warnings = finalizeRegistries(registries, loaded.flatMap((p) => p.extensions))
    return { registries, warnings }
}

const REGISTERED = new Set(REGISTERED_PUBLIC_FEATURE_IDS)

describe('fqid canonicalization on the real (production) feature set', () => {
    it('resolves every shared:* id in nuxt4-ai to a fqid and drops every unregistered nuxt4:* id', () => {
        const { registries } = loadRealFeatureSet()
        const t = registries.templates.get('nuxt4-ai')
        assert.deepEqual(t.requiredFeatures, expectedResolved(NUXT_AI_REQUIRED, REGISTERED, 'battlestack'))
        assert.deepEqual(t.optionalFeatures, expectedResolved(NUXT_AI_OPTIONAL, REGISTERED, 'battlestack'))
        // Every surviving entry is a real fqid; nothing bare leaks through.
        for (const id of [...t.requiredFeatures, ...t.optionalFeatures]) {
            assert.match(id, /^battlestack:shared:/)
        }
    })

    it('resolves nuxt4-minimal the same way, independently of nuxt4-ai', () => {
        const { registries } = loadRealFeatureSet()
        const t = registries.templates.get('nuxt4-minimal')
        assert.deepEqual(t.requiredFeatures, expectedResolved(NUXT_MINIMAL_REQUIRED, REGISTERED, 'battlestack'))
        assert.deepEqual(t.optionalFeatures, expectedResolved(NUXT_MINIMAL_OPTIONAL, REGISTERED, 'battlestack'))
    })

    it('applies the internal plugin\'s shared:deploy extension to nuxt4-fullstack only, appended after the resolved public list', () => {
        const { registries } = loadRealFeatureSet()
        const fullstack = registries.templates.get('nuxt4-fullstack')
        const publicResolved = expectedResolved(NUXT_FULLSTACK_REQUIRED, REGISTERED, 'battlestack')
        assert.deepEqual(fullstack.requiredFeatures, [...publicResolved, 'acme:shared:deploy'])
        assert.deepEqual(fullstack.optionalFeatures, expectedResolved(NUXT_FULLSTACK_OPTIONAL, REGISTERED, 'battlestack'))

        // Siblings are untouched by an extension targeting a different template id.
        const ai = registries.templates.get('nuxt4-ai')
        const minimal = registries.templates.get('nuxt4-minimal')
        assert.equal(ai.requiredFeatures.includes('acme:shared:deploy'), false)
        assert.equal(minimal.requiredFeatures.includes('acme:shared:deploy'), false)
    })

    it('produces exactly one warning per unresolved nuxt4:* occurrence, none of them fatal', () => {
        const { warnings } = loadRealFeatureSet()
        // `defaultEnabledOptional` resolves against the already-canonicalized
        // `optionalFeatures` rather than re-resolving, so it never warns twice.
        const expectedCount = [
            ...NUXT_AI_REQUIRED, ...NUXT_AI_OPTIONAL,
            ...NUXT_FULLSTACK_REQUIRED, ...NUXT_FULLSTACK_OPTIONAL,
            ...NUXT_MINIMAL_REQUIRED, ...NUXT_MINIMAL_OPTIONAL,
        ].filter((id) => !REGISTERED.has(id)).length
        assert.equal(warnings.length, expectedCount)
        assert.ok(warnings.every((w) => /dropped/.test(w)))
        // A representative sample, not the full per-template list.
        assert.ok(warnings.some((w) => w.includes('nuxt4:auth') && w.includes('nuxt4-ai')))
        assert.ok(warnings.some((w) => w.includes('nuxt4:mastra') && w.includes('nuxt4-fullstack')))
    })

    it('canonicalizes defaultEnabledOptional to the same fqid form as optionalFeatures: every surviving default-on id resolves against it', () => {
        const { registries } = loadRealFeatureSet()
        const fullstack = registries.templates.get('nuxt4-fullstack')
        const expected = expectedResolved(NUXT_FULLSTACK_DEFAULT_ENABLED, REGISTERED, 'battlestack')
        assert.deepEqual(fullstack.defaultEnabledOptional, expected)
        // The bug this pins: `shared:ci` was canonicalized in `optionalFeatures` but
        // stayed bare in `defaultEnabledOptional`, so `includes(id)` never matched.
        assert.equal(fullstack.defaultEnabledOptional?.includes('battlestack:shared:ci'), true)
        assert.equal(fullstack.optionalFeatures.includes('battlestack:shared:ci'), true)
        for (const id of fullstack.defaultEnabledOptional ?? []) {
            assert.ok(fullstack.optionalFeatures.includes(id), `${id} not in optionalFeatures`)
        }
    })
})
