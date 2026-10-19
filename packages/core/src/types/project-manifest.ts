import type { InstalledFeatureRecord } from './feature.js'

/** Lock-style file at `.battlestack/manifest.json`. Source of truth for `battlestack pull`. */
export interface ProjectManifest {
    schemaVersion: 1
    cliVersion: string
    framework: string
    template: string
    packageManager: string
    /** The project's name. A different directory name does not change it; `battlestack rename` does. */
    projectName?: string
    /** Prior project names, appended by `renameProject`. */
    previousNames?: string[]
    /** The name generated files still carry after `battlestack rename`. Set until a pull re-renders them. */
    renderedName?: string
    createdAt: string
    updatedAt: string
    /** True while a scaffold or pull is mid-flight, and after one crashes. */
    incomplete?: boolean
    features: InstalledFeatureRecord[]
    /** Feature ids removed via `battlestack remove`. Pull never rehydrates these. */
    optedOut?: string[]
    /** Cross-cutting policy state (top-level, multi-feature). */
    policies?: Record<string, unknown>
}
