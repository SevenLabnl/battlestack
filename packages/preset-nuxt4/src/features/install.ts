import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { type Feature, type RunContext, type PackageManager } from '@battlestack/core'
import { readJson, writeJson } from '@battlestack/core/utils/fs.js'
import { run } from '@battlestack/core/utils/run.js'
import { ensureWorkspaceMarker, installArgs, lockfileSyncArgs } from '@battlestack/core/utils/package-manager.js'
import { collectSkillSources, installSkills } from '@battlestack/core/utils/skills.js'
import { STAGE } from '@battlestack/core/constants/stages.js'
import { ui } from '@battlestack/tui'

/** Aggregates `collectDeps()` into `package.json`, then installs. Runs on `pull` too. */
export const installFeature: Feature = {
    id: 'shared:install',
    version: '1.2.0',
    label: 'package.json + install',
    stage: STAGE.FINALIZE,

    async execute(ctx) {
        await applyInstall(ctx, { skipInstallIfUnchanged: false })
    },

    async update(ctx, _prev) {
        const changed = await applyInstall(ctx, { skipInstallIfUnchanged: true })
        if (changed) return { written: ['package.json'], skipped: [], notes: [] }
        return { written: [], skipped: [], notes: ['package.json unchanged, install skipped'] }
    },
}

async function applyInstall(
    ctx: RunContext,
    opts: { skipInstallIfUnchanged: boolean },
): Promise<boolean> {
    const pm = String(ctx.state.packageManager ?? 'pnpm') as PackageManager
    const { prod, dev } = collectDeclaredDeps(ctx)

    const pkgPath = path.join(ctx.projectDir, 'package.json')
    const pkg = await readJson<Record<string, unknown>>(pkgPath)
    const beforeSnapshot = JSON.stringify(pkg)

    reconcileDependencyBuckets(pkg, Object.fromEntries(prod), Object.fromEntries(dev))
    // No `packageManager` pin: generated projects float their PM. Node 24 LTS is the floor.
    pkg.engines = { ...(pkg.engines as Record<string, string> | undefined), node: '>=24' }
    await migrateLegacyBuildAllowlist(ctx.projectDir, pkg)

    const changed = beforeSnapshot !== JSON.stringify(pkg)
    if (changed) await writeJson(pkgPath, pkg)

    if (ctx.state.skipInstall) return changed
    // A byte-identical package.json skips the install. Scaffold always installs.
    const needsDepInstall = changed || !opts.skipInstallIfUnchanged
    if (needsDepInstall) {
        await runInstallWithBuildApproval(pm, ctx)
        // `'latest'` entries are pinned to the version that landed.
        const pinnedAny = await pinResolvedVersions(ctx.projectDir)
        // Pinning leaves the lockfile on `latest`, so it is re-synced here.
        if (pinnedAny) await run(pm, lockfileSyncArgs(pm), { cwd: ctx.projectDir, inherit: ctx.debug })
    }
    // Feature-declared skills, refreshed on scaffold and every pull regardless of dep changes.
    await installSkills(ctx, collectSkillSources(ctx, ctx.registries))
    // Formatting runs in a post-orchestrator step.
    return changed
}

/** `collectDeps()` across enabled features. Conflicting pins throw. */
function collectDeclaredDeps(ctx: RunContext): {
    prod: Map<string, string>
    dev: Map<string, string>
} {
    const prod = new Map<string, string>()
    const dev = new Map<string, string>()
    const seenBy = new Map<string, { feature: string, version: string }>()

    const record = (
        target: Map<string, string>,
        name: string,
        version: string,
        featureId: string,
    ): void => {
        const prior = seenBy.get(name)
        if (prior && prior.version !== version) {
            throw new Error(
                `npm dependency conflict: "${name}" pinned by `
                + `${prior.feature} (${prior.version}) and ${featureId} (${version}). `
                + `Reconcile in one of the features' collectDeps().`,
            )
        }
        if (!prior) seenBy.set(name, { feature: featureId, version })
        target.set(name, version)
    }

    for (const id of ctx.enabledFeatures) {
        if (!ctx.registries.features.has(id)) continue
        const deps = ctx.registries.features.get(id).collectDeps?.(ctx)
        for (const d of deps?.prod ?? []) {
            const [name, version] = splitSpec(d)
            record(prod, name, version, id)
        }
        for (const d of deps?.dev ?? []) {
            const [name, version] = splitSpec(d)
            record(dev, name, version, id)
        }
    }
    return { prod, dev }
}

/** Merges declared deps into package.json buckets in place. A user pin survives, and moves with it. */
function reconcileDependencyBuckets(
    pkg: Record<string, unknown>,
    incomingProd: Record<string, string>,
    incomingDev: Record<string, string>,
): void {
    const existingProd = (pkg.dependencies as Record<string, string>) ?? {}
    const existingDev = (pkg.devDependencies as Record<string, string>) ?? {}

    const migrated: Record<string, string> = {}
    const splitBucket = (
        existing: Record<string, string>,
        movesTo: Record<string, string>,
    ): Record<string, string> => {
        const cleaned: Record<string, string> = {}
        for (const [name, ver] of Object.entries(existing)) {
            if (movesTo[name]) migrated[name] = ver
            else cleaned[name] = ver
        }
        return cleaned
    }
    const cleanedProd = splitBucket(existingProd, incomingDev)
    const cleanedDev = splitBucket(existingDev, incomingProd)

    const carryProdIntoDev: Record<string, string> = { ...incomingDev }
    const carryDevIntoProd: Record<string, string> = { ...incomingProd }
    for (const [name, pin] of Object.entries(migrated)) {
        if (incomingDev[name] && pin !== 'latest') carryProdIntoDev[name] = pin
        if (incomingProd[name] && pin !== 'latest') carryDevIntoProd[name] = pin
    }
    pkg.dependencies = mergeDeps(cleanedProd, carryDevIntoProd)
    pkg.devDependencies = mergeDeps(cleanedDev, carryProdIntoDev)
}

/** Moves a legacy package.json `pnpm` field's entries to `pnpm-workspace.yaml`'s `allowBuilds:`. */
async function migrateLegacyBuildAllowlist(
    projectDir: string,
    pkg: Record<string, unknown>,
): Promise<void> {
    const pnpmField = pkg.pnpm as Record<string, unknown> | undefined
    const legacy = pnpmField?.onlyBuiltDependencies
    if (!pnpmField || !Array.isArray(legacy)) return

    if (legacy.length > 0) {
        await ensureWorkspaceMarker(projectDir)
        const yamlPath = path.join(projectDir, 'pnpm-workspace.yaml')
        let yaml = await readFile(yamlPath, 'utf8')
        if (!/^allowBuilds:/m.test(yaml)) {
            yaml += (yaml.endsWith('\n') || yaml === '' ? '' : '\n') + 'allowBuilds:\n'
        }
        for (const name of legacy as string[]) {
            const key = name.startsWith('@') ? `'${name}'` : name
            if (yaml.includes(`${key}: true`)) continue
            yaml = yaml.replace(/^allowBuilds:\n/m, `allowBuilds:\n    ${key}: true\n`)
        }
        await writeFile(yamlPath, yaml, 'utf8')
    }

    delete pnpmField.onlyBuiltDependencies
    if (Object.keys(pnpmField).length === 0) delete pkg.pnpm
}

/** Replaces `'latest'` with the caret-pinned version in `node_modules`. Missing packages stay. */
async function pinResolvedVersions(projectDir: string): Promise<boolean> {
    const pkgPath = path.join(projectDir, 'package.json')
    const pkg = await readJson<Record<string, unknown>>(pkgPath)
    const before = JSON.stringify(pkg)

    const resolveOne = async (name: string): Promise<string | null> => {
        try {
            const installed = await readJson<{ version?: string }>(
                path.join(projectDir, 'node_modules', name, 'package.json'),
            )
            const v = installed.version
            if (typeof v !== 'string' || v.length === 0) return null
            return `^${v}`
        } catch {
            return null
        }
    }

    const pinBucket = async (bucket: 'dependencies' | 'devDependencies'): Promise<void> => {
        const entries = pkg[bucket] as Record<string, string> | undefined
        if (!entries) return
        for (const [name, spec] of Object.entries(entries)) {
            if (spec !== 'latest') continue
            const pinned = await resolveOne(name)
            if (pinned) entries[name] = pinned
        }
    }

    await pinBucket('dependencies')
    await pinBucket('devDependencies')

    const changed = JSON.stringify(pkg) !== before
    if (changed) await writeJson(pkgPath, pkg)
    return changed
}

/** Recovers from `[ERR_PNPM_IGNORED_BUILDS]`: stash the output, approve builds, retry once. */
async function runInstallWithBuildApproval(pm: PackageManager, ctx: RunContext): Promise<void> {
    const installOpts = { cwd: ctx.projectDir, inherit: ctx.debug }
    let installError: unknown = null
    try {
        await run(pm, installArgs(pm), installOpts)
    } catch (err) {
        installError = err
    }
    if (pm !== 'pnpm') {
        if (installError) throw installError
        return
    }
    await ensureWorkspaceMarker(ctx.projectDir)
    try {
        await run('pnpm', ['approve-builds', '--all'], installOpts)
    } catch (error_) {
        // approve-builds itself failed.
        throw installError ?? error_
    }
    if (!installError) return
    // Retried once, now that pending builds are approved.
    await run(pm, installArgs(pm), installOpts)
}

/** Runs `eslint . --fix` from the orchestrator's `PostRunFormatter` and from `pull`. */
export async function formatProject(ctx: RunContext): Promise<void> {
    if (ctx.state.skipInstall) return
    if (ctx.dryRun) return
    const pm = String(ctx.state.packageManager ?? 'pnpm') as PackageManager
    try {
        await run(pm, eslintFixArgs(pm), { cwd: ctx.projectDir, inherit: ctx.debug })
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        ui.warn(`eslint --fix failed (non-fatal): ${msg}`)
    }
}

function splitSpec(spec: string): [string, string] {
    const aliasAt = spec.indexOf('@npm:')
    if (aliasAt > 0) return [spec.slice(0, aliasAt), spec.slice(aliasAt + 1)]
    const lastAt = spec.lastIndexOf('@')
    if (lastAt > 0) return [spec.slice(0, lastAt), spec.slice(lastAt + 1)]
    return [spec, 'latest']
}

function eslintFixArgs(pm: PackageManager): string[] {
    switch (pm) {
        case 'pnpm':
            return ['exec', 'eslint', '.', '--fix', '--no-warn-ignored']
        case 'bun':
            return ['x', 'eslint', '.', '--fix', '--no-warn-ignored']
        case 'npm':
            return ['exec', '--', 'eslint', '.', '--fix', '--no-warn-ignored']
    }
}

/** Features only overwrite a dep when the existing value is `latest`, absent, or already equal. */
function mergeDeps(
    existing: Record<string, string>,
    incoming: Record<string, string>,
): Record<string, string> {
    const out: Record<string, string> = { ...existing }
    for (const [name, version] of Object.entries(incoming)) {
        const prior = out[name]
        if (!prior || prior === 'latest' || version !== 'latest') {
            out[name] = version
        }
    }
    return out
}
