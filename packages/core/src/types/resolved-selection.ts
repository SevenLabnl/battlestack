import type { Framework } from './framework.js'
import type { Template } from './template.js'

export interface ResolvedSelection {
    framework: Framework
    template: Template
    /** Final enabled feature ids (required ∪ chosen optional). */
    enabled: Set<string>
}
