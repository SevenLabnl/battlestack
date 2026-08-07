/** `.battlestack/local.json`: gitignored per-developer state. Not committed. */
export interface LocalState {
    gateway?: {
        enabled: boolean
        hostname?: string
    }
}
