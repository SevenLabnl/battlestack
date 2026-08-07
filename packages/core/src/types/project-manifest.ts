import type { InstalledFeatureRecord } from './feature.js'

/** Lock-style file at `.battlestack/manifest.json`. Source of truth for `battlestack pull`. */
export interface ProjectManifest {
    schemaVersion: 1
    cliVersion: string
    framework: string
    template: string
    packageManager: string
    /** Directory basename the project last ran under. A mismatch is a rename. */
    projectName?: string
    /** Prior directory basenames, appended by `reconcileProjectName` on each rename. */
    previousNames?: string[]
    createdAt: string
    updatedAt: string
    /** True while a scaffold or pull is mid-flight, and after one crashes. */
    incomplete?: boolean
    features: InstalledFeatureRecord[]
    /** Feature ids removed via `battlestack remove`. Pull never rehydrates these. */
    optedOut?: string[]
    /** Cross-cutting policy state (top-level, multi-feature). */
    policies?: {
        releaseAge?: {
            /** ISO timestamp when the policy was first installed. */
            startedAt: string
            /** Target days. Defaults to 7. */
            targetDays: number
            /** Current ramp value (days). Bumped by preCheck as the project ages. */
            currentDays: number
        }
        [key: string]: unknown
    }
}
