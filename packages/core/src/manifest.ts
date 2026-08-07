import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile as readFileAsync } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { exists, readJson, writeJson } from './utils/fs.js'
import type { InstalledFeatureRecord } from './types/feature.js'
import type { ProjectManifest } from './types/project-manifest.js'
import type { RunContext } from './types/run-context.js'
import type { BattlestackRegistries } from './registry.js'
import { getUiPort } from './ui-port.js'
import { migrateStateDir, STATE_DIR } from './utils/state-dir.js'

export const MANIFEST_PATH = `${STATE_DIR}/manifest.json`

const LEGACY_FRAMEWORK = 'nuxt'
const LEGACY_FEATURE_PREFIX = 'nuxt:'
const NUXT4_FRAMEWORK = 'nuxt4'
const NUXT4_FEATURE_PREFIX = 'nuxt4:'

/** In memory, rewrites `nuxt` to `nuxt4` and two-segment ids to fqids. True if anything changed. */
export function migrateManifest(manifest: ProjectManifest, registries?: BattlestackRegistries): boolean {
    let migrated = false

    const canonical = (id: string): string => {
        const bumped = id.startsWith(LEGACY_FEATURE_PREFIX)
            ? NUXT4_FEATURE_PREFIX + id.slice(LEGACY_FEATURE_PREFIX.length)
            : id
        if (registries?.features.has(bumped)) return registries.features.get(bumped).fqid
        return bumped
    }

    if (manifest.framework === LEGACY_FRAMEWORK) {
        manifest.framework = NUXT4_FRAMEWORK
        migrated = true
    }

    for (const record of manifest.features ?? []) {
        const next = canonical(record.id)
        if (next !== record.id) {
            record.id = next
            migrated = true
        }
    }

    if (manifest.optedOut) {
        const mapped = manifest.optedOut.map(canonical)
        if (mapped.some((v, i) => v !== manifest.optedOut![i])) {
            manifest.optedOut = mapped
            migrated = true
        }
    }

    if (migrated) {
        getUiPort().debug('migrated legacy "nuxt" manifest to "nuxt4" (pinned to v4)')
    }
    return migrated
}

const FALLBACK_CORE_VERSION = readCoreVersion()

/** The version in `packages/core/package.json`. */
function readCoreVersion(): string {
    try {
        const here = path.dirname(fileURLToPath(import.meta.url))
        const pkgPath = path.resolve(here, '..', 'package.json')
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
        return pkg.version ?? '0.0.0'
    } catch {
        return '0.0.0'
    }
}

/** Loads, normalizes and migrates the manifest in memory. `needsRewrite` if either pass changed it. */
async function loadAndMigrate(
    projectDir: string,
    registries?: BattlestackRegistries,
): Promise<{ manifest: ProjectManifest | null, needsRewrite: boolean }> {
    await migrateStateDir(projectDir)
    const target = path.join(projectDir, MANIFEST_PATH)
    if (!(await exists(target))) return { manifest: null, needsRewrite: false }
    const { manifest, changed: normalized } = normalizeManifest(await readJson<ProjectManifest>(target))
    const migrated = migrateManifest(manifest, registries)
    return { manifest, needsRewrite: normalized || migrated }
}

export async function readManifest(
    projectDir: string,
    registries?: BattlestackRegistries,
): Promise<ProjectManifest | null> {
    return (await loadAndMigrate(projectDir, registries)).manifest
}

/** Structural equality. Keys compare order-independently; arrays compare element-wise. */
function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
        return a.every((v, i) => deepEqual(v, b[i]))
    }
    const ao = a as Record<string, unknown>
    const bo = b as Record<string, unknown>
    const aKeys = Object.keys(ao)
    if (aKeys.length !== Object.keys(bo).length) return false
    return aKeys.every((k) => k in bo && deepEqual(ao[k], bo[k]))
}

const byId = (a: InstalledFeatureRecord, b: InstalledFeatureRecord): number => a.id.localeCompare(b.id)

/** Whether writing `candidate` over `onDisk` is a no-op. Excludes `updatedAt`; sorts `features`. */
function manifestUnchanged(candidate: ProjectManifest, onDisk: ProjectManifest): boolean {
    const { updatedAt: _c, features: candidateFeatures, ...candidateRest } = candidate
    const { updatedAt: _d, features: onDiskFeatures, ...onDiskRest } = onDisk
    return deepEqual(candidateRest, onDiskRest)
        && deepEqual([...candidateFeatures].sort(byId), [...onDiskFeatures].sort(byId))
}

/** Fills a blank `packageManager` and a non-array `features`. `changed` forces a write. */
function normalizeManifest(manifest: ProjectManifest): { manifest: ProjectManifest, changed: boolean } {
    let changed = false
    if (typeof manifest.packageManager !== 'string' || manifest.packageManager.trim() === '') {
        manifest.packageManager = 'pnpm'
        changed = true
    }
    if (!Array.isArray(manifest.features)) {
        manifest.features = []
        changed = true
    }
    return { manifest, changed }
}

export async function writeManifest(
    ctx: RunContext,
    opts: { incomplete?: boolean, cliVersion?: string } = {},
): Promise<void> {
    const target = path.join(ctx.projectDir, MANIFEST_PATH)
    const { manifest: previous, needsRewrite } = await loadAndMigrate(ctx.projectDir, ctx.registries)

    const records: InstalledFeatureRecord[] = []
    for (const id of ctx.enabledFeatures) {
        // Orphan feature: dropped from the registry since scaffold.
        if (!ctx.registries.features.has(id)) continue
        const feature = ctx.registries.features.get(id)
        const bareStateId = feature.id
        const fqidRecordId = feature.fqid
        const prev = previous?.features.find((f) => f.id === fqidRecordId)
        const filesFromState
            = (ctx.state[`files:${bareStateId}`] as Record<string, string> | undefined) ?? prev?.files ?? {}
        const ownedFromState
            = (ctx.state[`owned:${bareStateId}`] as string[] | undefined) ?? prev?.ownedByUser
        const stashed = ctx.state[`state:${bareStateId}`] as Record<string, unknown> | undefined
        // New writes win.
        const mergedState = stashed
            ? { ...prev?.state, ...stashed }
            : prev?.state
        records.push({
            id: fqidRecordId,
            version: feature.version,
            files: filesFromState,
            ...(ownedFromState && ownedFromState.length > 0
                ? { ownedByUser: ownedFromState }
                : {}),
            ...(mergedState && Object.keys(mergedState).length > 0
                ? { state: mergedState }
                : {}),
        })
    }
    // Deterministic on-disk order.
    records.sort(byId)

    const policies
        = ctx.state.policies ?? previous?.policies

    const optedOut
        = (ctx.state.optedOut as string[] | undefined) ?? previous?.optedOut

    const manifest: ProjectManifest = {
        schemaVersion: 1,
        cliVersion: opts.cliVersion ?? FALLBACK_CORE_VERSION,
        framework: ctx.framework.id,
        template: ctx.template.id,
        packageManager: String(ctx.state.packageManager ?? 'pnpm'),
        projectName: path.basename(ctx.projectDir),
        ...(previous?.previousNames?.length ? { previousNames: previous.previousNames } : {}),
        createdAt: previous?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...(opts.incomplete ? { incomplete: true } : {}),
        features: records,
        ...(optedOut && optedOut.length > 0 ? { optedOut } : {}),
        ...(policies ? { policies } : {}),
    }

    if (previous && !needsRewrite && manifestUnchanged(manifest, previous)) return

    await writeJson(target, manifest)
}

/** Restamps `projectName` after a directory rename. Returns the previous name, or null. */
export async function reconcileProjectName(
    projectDir: string,
    manifest: ProjectManifest,
): Promise<string | null> {
    const current = path.basename(projectDir)
    const recorded = manifest.projectName
    if (recorded === current) return null
    manifest.projectName = current
    if (recorded) {
        const prev = new Set(manifest.previousNames ?? [])
        prev.add(recorded)
        prev.delete(current)
        manifest.previousNames = [...prev]
    }
    manifest.updatedAt = new Date().toISOString()
    await writeJson(path.join(projectDir, MANIFEST_PATH), manifest)
    return recorded ?? null
}

/** A file matching its recorded hash is unmodified and safe to overwrite. */
export async function hashFile(absolutePath: string): Promise<string> {
    const buf = await readFileAsync(absolutePath)
    return createHash('sha256').update(buf).digest('hex')
}

export function recordFile(
    ctx: RunContext,
    featureId: string,
    relativePath: string,
    hash: string,
): void {
    const key = `files:${featureId}`
    const map = (ctx.state[key] as Record<string, string> | undefined) ?? {}
    map[relativePath] = hash
    ctx.state[key] = map
}

/** Idempotent. */
export function dropRecordedFile(
    ctx: RunContext,
    featureId: string,
    relativePath: string,
): void {
    const key = `files:${featureId}`
    const map = ctx.state[key] as Record<string, string> | undefined
    if (!map || !(relativePath in map)) return
    ctx.state[key] = Object.fromEntries(
        Object.entries(map).filter(([rel]) => rel !== relativePath),
    )
}

/** Idempotent. */
export function recordOwned(
    ctx: RunContext,
    featureId: string,
    relativePath: string,
): void {
    const key = `owned:${featureId}`
    const list = (ctx.state[key] as string[] | undefined) ?? []
    if (!list.includes(relativePath)) list.push(relativePath)
    ctx.state[key] = list
}

/** Flags `relativePath` as created by this run rather than overwritten. */
export function recordCreated(
    ctx: RunContext,
    featureId: string,
    relativePath: string,
): void {
    const key = `created:${featureId}`
    const set = (ctx.state[key] as Set<string> | undefined) ?? new Set<string>()
    set.add(relativePath)
    ctx.state[key] = set
}

/** Reaches `update()` as `prev.state[key]`. */
export function saveFeatureState(
    ctx: RunContext,
    featureId: string,
    key: string,
    value: unknown,
): void {
    const bagKey = `state:${featureId}`
    const bag = (ctx.state[bagKey] as Record<string, unknown> | undefined) ?? {}
    bag[key] = value
    ctx.state[bagKey] = bag
}
