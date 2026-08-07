/** An id, a label, and the catalog of feature ids a project may carry. */
export interface Framework {
    id: string
    label: string
    description?: string
    /** A catalog of what a project may carry, not of what this package registers. */
    supportedFeatures: string[]
}
