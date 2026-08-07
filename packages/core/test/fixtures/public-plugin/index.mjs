// Test fixture standing in for the real `@battlestack/preset-nuxt` package
// (packages/preset-nuxt/src/index.ts): same plugin `name` (so namespace
// derivation matches production: 'battlestack'), same shape of feature ids
// and a public template with the deploy feature stripped, per the DECOUPLE
// rule in PORT-PLAN.md ("Templates must never list a feature the public
// build doesn't register"). Plain .mjs (no TS) because `loadPlugins` resolves
// and dynamically `import()`s the entry at runtime, same as the real loader
// would for an installed package: this exercises that path for real instead
// of stubbing it out.
export default {
    name: '@battlestack/preset-nuxt',
    apiVersion: 1,
    register(battlestack) {
        battlestack.addFramework({ id: 'nuxt', label: 'Nuxt 4', supportedFeatures: ['nuxt4:auth', 'shared:docker'] })
        battlestack.addFeature({
            id: 'shared:docker', label: 'Docker', stage: 'FINALIZE', version: '1.0.0', execute: async () => {},
        })
        battlestack.addFeature({
            id: 'nuxt4:auth', label: 'Auth', stage: 'AUTH', version: '1.0.0', execute: async () => {},
        })
        battlestack.addTemplate({
            id: 'nuxt4-fullstack',
            label: 'Nuxt: full stack',
            framework: 'nuxt',
            requiredFeatures: ['nuxt4:auth'],
            optionalFeatures: ['shared:docker'],
        })
        battlestack.addCommand({ id: 'create', description: 'Scaffold a new project', run() {} })
        battlestack.addDeployTarget({ id: 'docker', label: 'Docker Compose (self-hosted)' })
    },
}
