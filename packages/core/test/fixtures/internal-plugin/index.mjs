// Test fixture standing in for a private, store-installed plugin (see
// `../../../src/plugin.ts`'s doc comment on `TemplateExtension`): same shape
// as a real third-party plugin: namespace derives from the package scope
// ('acme'), extends the public preset's `nuxt4-fullstack` template with
// `shared:deploy`, and contributes a private-only command + deploy target.
// never installed in a public build.
export default {
    name: '@acme/battlestack-plugin',
    apiVersion: 1,
    register(battlestack) {
        battlestack.addFeature({
            id: 'shared:deploy', label: 'Deployment manifests', stage: 'FINALIZE', version: '1.0.0', execute: async () => {},
        })
        battlestack.extendTemplate({ templateId: 'nuxt4-fullstack', addFeatures: ['shared:deploy'] })
        battlestack.addCommand({ id: 'deploy', description: 'Deploy to Acme\'s private environment', run() {} })
        battlestack.addDeployTarget({ id: 'acme', label: 'Acme private environment' })
    },
}
