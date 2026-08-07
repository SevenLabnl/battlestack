import type { PackageManager } from './package-manager.js'

export interface SelfUpdateOptions {
    /** Force a specific package manager instead of auto-detecting. */
    packageManager?: PackageManager
    /** Pin to a specific version tag instead of `latest`. */
    tag?: string
    /** Install the true latest even when younger than the gate. Reinstalls when up to date. */
    force?: boolean
}

/** What pnpm's minimum-release-age gate allows right now, from registry publish times. */
export interface GatedTarget {
    /** Newest version old enough to pass the gate, or null when none qualify. */
    version: string | null
    /** Effective gate window in minutes. */
    gateMinutes: number
    /** Local-time timestamp at which the true latest clears the gate (display only). */
    unlocksAt: string | null
}

/** Outcome of the self-update protective-window policy. */
export interface UpdateDecision {
    action: 'install' | 'skip'
    /** Exact version to pin; null falls back to the raw tag. */
    targetVersion: string | null
    /** A newer release exists but sits inside the protective window. */
    heldBack: boolean
}
