/** A curated bundle: framework plus required and opt-in features. */
export interface Template {
    id: string
    label: string
    description?: string
    framework: string
    requiredFeatures: string[]
    optionalFeatures: string[]
    /** Subset of `optionalFeatures` checked-by-default in the prompt. */
    defaultEnabledOptional?: string[]
}
