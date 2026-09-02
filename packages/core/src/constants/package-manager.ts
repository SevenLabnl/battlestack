import type { PackageManager } from '../types/package-manager.js'

export const SUPPORTED_PMS: PackageManager[] = ['pnpm', 'bun', 'npm']

/** Order of preference when nothing is specified. */
export const DEFAULT_PM_PRIORITY: PackageManager[] = ['pnpm', 'bun', 'npm']

/** The pnpm version this repo develops and tests against. Not injected into generated projects. */
export const PNPM_PIN = 'pnpm@11.8.0'

/** Oldest pnpm the scaffold supports. Preflight fails below it. */
export const PNPM_MIN = '11.3.0'

/** Day-0 release-age. Must be 0, and must be set explicitly. */
export const RELEASE_AGE_SCAFFOLD_DAYS = 0

/** Native-build packages the boilerplate pulls in, pre-seeded into `pnpm-workspace.yaml#allowBuilds`. */
export const BOILERPLATE_ALLOWED_BUILDS: readonly string[] = [
    '@parcel/watcher',
    'esbuild',
    'lefthook',
    'sharp',
    'unrs-resolver',
    'vue-demi',
]
