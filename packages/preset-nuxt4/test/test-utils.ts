import { BattlestackRegistries, type RunContext } from '@battlestack/core'

/**
 * Test-only `RunContext` factory. Not exported from `@battlestack/core`'s package
 * surface, so each package keeps its own copy.
 */
export function mockRunContext(overrides: Partial<RunContext> = {}): RunContext {
    return {
        projectName: 'test-project',
        projectDir: '/tmp/test',
        framework: { id: 'nuxt', label: 'Nuxt', supportedFeatures: [] },
        template: {
            id: 'nuxt4-minimal',
            label: 'Nuxt (minimal)',
            framework: 'nuxt',
            requiredFeatures: [],
            optionalFeatures: [],
        },
        enabledFeatures: new Set(),
        state: {},
        debug: false,
        dryRun: false,
        // Empty by default; tests needing real lookups pass their own via `overrides`.
        registries: new BattlestackRegistries(),
        ...overrides,
    }
}
