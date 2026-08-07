import type { FeatureState } from './feature.js'
import type { Framework } from './framework.js'
import type { Template } from './template.js'
import type { BattlestackRegistries } from '../registry.js'

/** `enabledFeatures` holds fully-qualified ids. Use `enabledHas` to test an authored id. */
export interface RunContext {
    projectName: string
    projectDir: string
    framework: Framework
    template: Template
    /** Feature ids that will run (required ∪ opt-in selections). */
    enabledFeatures: Set<string>
    state: FeatureState
    debug: boolean
    dryRun: boolean
    /** Finalized registries this run resolves feature/template/deploy-target ids against. */
    registries: BattlestackRegistries
}
