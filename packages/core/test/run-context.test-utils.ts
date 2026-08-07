import { BattlestackRegistries } from '../src/registry.js'
import type { RunContext } from '../src/types/run-context.js'

/** Test-only `RunContext` factory with safe defaults. */
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
