import path from 'node:path'
import { rm } from 'node:fs/promises'
import type { Ora } from 'ora'
import {
    classifyFileState,
    CLIError,
    ErrorCode,
    exists,
    findProjectRoot,
    installArgs,
    readJson,
    readManifest,
    recordOwned,
    run,
    writeJson,
    writeManifest,
    type BattlestackRegistries,
    type EnvVar,
    type Feature,
    type PackageManager,
    type ParsedArgs,
    type ReservedCommand,
    type RunContext,
} from '@battlestack/core'
import { applyEnv, collectEnvForFeature } from '@battlestack/preset-nuxt4'
import { ui } from '@battlestack/tui'

/** Static metadata only. `run` is built per-dispatch in `project.ts`. */
export const addReservedMeta: Omit<ReservedCommand, 'run'> = {
    name: 'add',
    usage: 'battlestack add <feature>',
    label: 'enable an optional feature',
    group: 'Lifecycle',
}

export const removeReservedMeta: Omit<ReservedCommand, 'run'> = {
    name: 'remove',
    usage: 'battlestack remove <feature>',
    label: 'disable a feature',
    group: 'Lifecycle',
}

export async function addCommand(args: ParsedArgs, loader: Ora, registries: BattlestackRegistries): Promise<void> {
    const requested = args.projectName
    if (!requested) {
        if (args.help) {
            await printAddHelp(registries)
            return
        }
        throw new CLIError(ErrorCode.UNKNOWN_FEATURE, 'Usage: battlestack add <feature-id>')
    }
    if (args.help) {
        await printAddHelp(registries)
        return
    }

    const projectRoot = await requireProjectRoot()
    const manifest = await readManifest(projectRoot, registries)
    if (!manifest) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            `No manifest at ${projectRoot}/.battlestack/manifest.json`,
        )
    }

    const template = registries.templates.get(manifest.template)
    // `requested` is resolved first: everything below compares fqids.
    if (!registries.features.has(requested)) {
        throw new CLIError(
            ErrorCode.UNKNOWN_FEATURE,
            `Unknown feature: ${requested}. `
            + `Optional features for "${template.id}": ${suggestable(manifest, template, registries)}`,
        )
    }
    const newFeature = registries.features.get(requested)
    const fqid = newFeature.fqid
    const bareStateId = newFeature.id

    if (manifest.features.some((f) => f.id === fqid)) {
        ui.skip(`${fqid} already installed`)
        return
    }

    const framework = registries.frameworks.get(manifest.framework)

    const blocker = addBlocker(newFeature, template, framework)
    if (blocker) {
        throw new CLIError(
            ErrorCode.UNSUPPORTED_FEATURE,
            `${blocker} Addable now: ${suggestable(manifest, template, registries)}`,
        )
    }

    const pm = manifest.packageManager as PackageManager
    const fullEnabled = [...manifest.features.map((f) => f.id), fqid]
    const ctx = buildCtx(projectRoot, manifest.framework, manifest.template, fullEnabled, pm, args, registries)
    // Pre-primed so writeManifest preserves existing entries. Keyed bare.
    for (const f of manifest.features) {
        if (!registries.features.has(f.id)) continue
        ctx.state[`files:${registries.features.get(f.id).id}`] = { ...f.files }
    }

    ui.section(`Add ${fqid}`)
    ui.dim(projectRoot)

    if (args.dryRun) {
        ui.info(`dry-run: would run ${fqid}.execute() and update manifest`)
        return
    }

    // Rollback covers only files this run created, tracked in `created:<id>`.
    try {
        await newFeature.execute(ctx)
        if (newFeature.structuralFiles) {
            for (const rel of newFeature.structuralFiles(ctx)) {
                recordOwned(ctx, bareStateId, rel)
            }
        }
    } catch (err) {
        await rollbackNewFiles(ctx, bareStateId)
        loader.fail(`${fqid} failed`)
        throw err
    }

    await mergeAndInstallDeps(ctx, newFeature, pm)

    const envDiff = await applyEnv(ctx)

    const filesFromState
        = (ctx.state[`files:${bareStateId}`] as Record<string, string> | undefined) ?? {}
    manifest.features.push({
        id: fqid,
        version: newFeature.version,
        files: filesFromState,
    })
    manifest.updatedAt = new Date().toISOString()
    ctx.enabledFeatures = new Set(manifest.features.map((f) => f.id))
    // Adding clears any prior opt-out.
    ctx.state.optedOut = (manifest.optedOut ?? []).filter((id) => id !== fqid)
    await writeManifest(ctx)

    ui.blank()
    ui.ok(`Added ${fqid}`)

    if (envDiff.newKeys.length > 0) {
        ui.blank()
        ui.warn('Verify these new env keys in .env')
        for (const k of envDiff.newKeys) ui.bullet(k)
        ui.dim('  Factory values were generated. Replace placeholders before running.')
    }
    if (envDiff.valueChanged.length > 0) {
        ui.blank()
        ui.warn('Consider updating these existing env keys')
        for (const c of envDiff.valueChanged) {
            const current = ui.color.dim(`(currently: ${c.current})`)
            ui.bullet(`${c.key}=${c.recommended}  ${current}`)
        }
        ui.dim('  .env was not modified; update manually to adopt the new defaults.')
    }
    ui.blank()
}

export async function removeCommand(args: ParsedArgs, _loader: Ora, registries: BattlestackRegistries): Promise<void> {
    const requested = args.projectName
    if (!requested) {
        throw new CLIError(ErrorCode.UNKNOWN_FEATURE, 'Usage: battlestack remove <feature-id>')
    }

    const projectRoot = await requireProjectRoot()
    const manifest = await readManifest(projectRoot, registries)
    if (!manifest) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            `No manifest at ${projectRoot}/.battlestack/manifest.json`,
        )
    }

    // Resolved up front, as `optedOut` is compared against fqid lists. Unknown ids stay as-is.
    const featureId = registries.features.has(requested)
        ? registries.features.get(requested).fqid
        : requested

    const record = manifest.features.find((f) => f.id === featureId)
    if (!record) {
        throw new CLIError(
            ErrorCode.UNSUPPORTED_FEATURE,
            `Feature is not installed: ${featureId}`,
        )
    }

    const template = registries.templates.get(manifest.template)
    const isRequired = template.requiredFeatures.includes(featureId)

    const myFiles = new Set(Object.keys(record.files))
    const conflicts: Array<{ rel: string, otherFeature: string }> = []
    for (const other of manifest.features) {
        if (other.id === featureId) continue
        for (const rel of Object.keys(other.files)) {
            if (myFiles.has(rel)) conflicts.push({ rel, otherFeature: other.id })
        }
    }
    if (conflicts.length > 0) {
        ui.fail('Cannot remove: files shared with other features')
        for (const c of conflicts) ui.bullet(`${c.rel} ${ui.color.dim('← also owned by ' + c.otherFeature)}`)
        throw new CLIError(ErrorCode.UNSUPPORTED_FEATURE, 'Shared file ownership prevents removal')
    }

    // pristine → delete, drifted → leave. Owned files are skipped.
    const pristine: string[] = []
    const drifted: string[] = []
    const ownedSet = new Set(record.ownedByUser ?? [])
    for (const [rel, recordedHash] of Object.entries(record.files)) {
        const abs = path.join(projectRoot, rel)
        const state = await classifyFileState(abs, recordedHash, ownedSet.has(rel))
        if (state === 'pristine' || state === 'missing') pristine.push(rel)
        else if (state === 'drifted') drifted.push(rel)
    }

    if (isRequired) {
        ui.warn(
            `"${featureId}" is a required feature for template "${template.id}". `
            + `Removing it may break the build until you bring it back with \`battlestack add ${featureId}\` `
            + `or switch templates. \`battlestack pull\` will NOT restore it once removed.`,
        )
    }

    if (args.dryRun) {
        ui.info(`dry-run: would delete ${pristine.length} pristine file(s)`)
        for (const rel of pristine) ui.dim(`  ${rel}`)
        if (drifted.length > 0) {
            ui.info(`would leave ${drifted.length} drifted file(s) for manual cleanup`)
            for (const rel of drifted) ui.dim(`  ${rel}`)
        }
        ui.dim(`  would record "${featureId}" as opted-out so \`battlestack pull\` leaves it gone`)
        return
    }

    let deleted = 0
    for (const rel of pristine) {
        const dest = path.join(projectRoot, rel)
        try {
            await rm(dest, { force: true })
            deleted++
        } catch (err) {
            ui.warn(`could not remove ${rel}: ${(err as Error).message}`)
        }
        await rm(`${dest}.battlestack.new`, { force: true })
        await rm(`${dest}.battlestack.patch`, { force: true })
    }

    const pm = manifest.packageManager as PackageManager
    const ctxForDeps = buildCtx(
        projectRoot,
        manifest.framework,
        manifest.template,
        manifest.features.map((f) => f.id),
        pm,
        args,
        registries,
    )
    const removedOnly = computeRemovedOnlyDeps(ctxForDeps, featureId, registries)
    await stripDepsAndInstall(ctxForDeps, removedOnly, pm)

    manifest.features = manifest.features.filter((f) => f.id !== featureId)
    manifest.updatedAt = new Date().toISOString()
    const ctx = buildCtx(
        projectRoot,
        manifest.framework,
        manifest.template,
        manifest.features.map((f) => f.id),
        pm,
        args,
        registries,
    )
    // Keyed bare, as `writeManifest` reads the state bag back by bare id.
    for (const f of manifest.features) {
        if (!registries.features.has(f.id)) continue
        ctx.state[`files:${registries.features.get(f.id).id}`] = { ...f.files }
    }
    ctx.state.optedOut = [...new Set([...(manifest.optedOut ?? []), featureId])]
    await writeManifest(ctx)

    ui.blank()
    ui.ok(
        `Removed ${featureId} (${deleted} file(s) deleted`
        + (drifted.length ? `, ${drifted.length} drifted left in place` : '')
        + ')',
    )
    ui.dim(`  opted out, so \`battlestack pull\` will not restore it. Re-enable with \`battlestack add ${featureId}\`.`)

    if (drifted.length > 0) {
        ui.blank()
        ui.warn('Drifted files left for manual cleanup')
        for (const rel of drifted) ui.bullet(rel)
    }

    const staleKeys = computeStaleEnvKeys(ctx, featureId)
    if (staleKeys.length > 0) {
        ui.blank()
        ui.warn('Consider removing these stale env keys from .env')
        for (const k of staleKeys) ui.bullet(k)
        ui.dim('  .env was not modified; remove manually if you want them gone.')
    }
    ui.blank()
}

/** Ids this project could actually `add`: registered, uninstalled, and unblocked. */
function suggestable(
    manifest: { features: Array<{ id: string }>, framework: string },
    template: { id: string, optionalFeatures: string[], requiredFeatures: string[] },
    registries: BattlestackRegistries,
): string {
    const framework = registries.frameworks.get(manifest.framework)
    const installed = new Set(manifest.features.map((f) => f.id))
    const ids = template.optionalFeatures.filter((id) =>
        !installed.has(id)
        && registries.features.has(id)
        && addBlocker(registries.features.get(id), template, framework) === null,
    )
    return ids.join(', ') || '(none)'
}

/** The message explaining why `feature` cannot be added here, or `null` if it can. */
function addBlocker(
    feature: Feature,
    template: { id: string, optionalFeatures: string[], requiredFeatures: string[] },
    framework: { id: string, supportedFeatures: string[] },
): string | null {
    const fqid = 'fqid' in feature ? String(feature.fqid) : feature.id
    // `Feature.frameworks` holds bare framework ids.
    if (feature.frameworks && !feature.frameworks.includes(framework.id)) {
        return `Feature "${fqid}" is not supported by framework "${framework.id}".`
    }
    if (!framework.supportedFeatures.includes(fqid)) {
        return `Feature "${fqid}" is not advertised by framework "${framework.id}". `
            + `Available: ${framework.supportedFeatures.join(', ') || '(none)'}`
    }
    if (!template.optionalFeatures.includes(fqid) && !template.requiredFeatures.includes(fqid)) {
        return `Feature "${fqid}" is not optional for template "${template.id}". `
            + `Optional features: ${template.optionalFeatures.join(', ') || '(none)'}`
    }
    return null
}

async function requireProjectRoot(): Promise<string> {
    const root = await findProjectRoot(process.cwd())
    if (!root) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            'Not inside a battlestack project (no .battlestack/manifest.json found).',
        )
    }
    return root
}

function buildCtx(
    projectRoot: string,
    frameworkId: string,
    templateId: string,
    enabled: string[],
    pm: PackageManager,
    args: ParsedArgs,
    registries: BattlestackRegistries,
): RunContext {
    return {
        projectName: path.basename(projectRoot),
        projectDir: projectRoot,
        framework: registries.frameworks.get(frameworkId),
        template: registries.templates.get(templateId),
        enabledFeatures: new Set(enabled),
        state: { packageManager: pm, skipInstall: args.skipInstall },
        debug: args.debug,
        dryRun: args.dryRun,
        registries,
    }
}

async function rollbackNewFiles(ctx: RunContext, featureId: string): Promise<void> {
    const created = (ctx.state[`created:${featureId}`] as Set<string> | undefined) ?? new Set()
    for (const rel of created) {
        const abs = path.join(ctx.projectDir, rel)
        try {
            await rm(abs, { force: true })
        } catch (err) {
            ui.warn(`rollback: could not remove ${rel}: ${(err as Error).message}`)
        }
    }
}

async function mergeAndInstallDeps(
    ctx: RunContext,
    newFeature: Feature,
    pm: PackageManager,
): Promise<void> {
    const deps = newFeature.collectDeps?.(ctx)
    const prod = new Map<string, string>()
    const dev = new Map<string, string>()
    for (const d of deps?.prod ?? []) {
        const [name, version] = splitSpec(d)
        prod.set(name, version)
    }
    for (const d of deps?.dev ?? []) {
        const [name, version] = splitSpec(d)
        dev.set(name, version)
    }
    if (prod.size === 0 && dev.size === 0) return

    const pkgPath = path.join(ctx.projectDir, 'package.json')
    const pkg = await readJson<Record<string, unknown>>(pkgPath)
    const existingProd = (pkg.dependencies as Record<string, string>) ?? {}
    const existingDev = (pkg.devDependencies as Record<string, string>) ?? {}

    pkg.dependencies = { ...existingProd, ...Object.fromEntries(prod) }
    pkg.devDependencies = { ...existingDev, ...Object.fromEntries(dev) }
    await writeJson(pkgPath, pkg)

    if (ctx.state.skipInstall) return
    await run(pm, installArgs(pm), { cwd: ctx.projectDir, inherit: ctx.debug })
}

function computeRemovedOnlyDeps(
    ctx: RunContext,
    removedId: string,
    registries: BattlestackRegistries,
): { prod: string[], dev: string[] } {
    if (!registries.features.has(removedId)) return { prod: [], dev: [] }
    const removed = registries.features.get(removedId)
    const removedDeps = removed.collectDeps?.(ctx) ?? {}
    const removedProd = new Set<string>()
    const removedDev = new Set<string>()
    for (const d of removedDeps.prod ?? []) removedProd.add(splitSpec(d)[0])
    for (const d of removedDeps.dev ?? []) removedDev.add(splitSpec(d)[0])

    const keptProd = new Set<string>()
    const keptDev = new Set<string>()
    for (const id of ctx.enabledFeatures) {
        if (id === removedId) continue
        if (!registries.features.has(id)) continue
        const f = registries.features.get(id)
        const d = f.collectDeps?.(ctx) ?? {}
        for (const x of d.prod ?? []) keptProd.add(splitSpec(x)[0])
        for (const x of d.dev ?? []) keptDev.add(splitSpec(x)[0])
    }
    return {
        prod: [...removedProd].filter((p) => !keptProd.has(p)),
        dev: [...removedDev].filter((p) => !keptDev.has(p)),
    }
}

async function stripDepsAndInstall(
    ctx: RunContext,
    deps: { prod: string[], dev: string[] },
    pm: PackageManager,
): Promise<void> {
    if (deps.prod.length === 0 && deps.dev.length === 0) return

    const pkgPath = path.join(ctx.projectDir, 'package.json')
    if (!(await exists(pkgPath))) return
    const pkg = await readJson<Record<string, unknown>>(pkgPath)
    const prod = (pkg.dependencies as Record<string, string>) ?? {}
    const dev = (pkg.devDependencies as Record<string, string>) ?? {}
    pkg.dependencies = Object.fromEntries(
        Object.entries(prod).filter(([name]) => !deps.prod.includes(name)),
    )
    pkg.devDependencies = Object.fromEntries(
        Object.entries(dev).filter(([name]) => !deps.dev.includes(name)),
    )
    await writeJson(pkgPath, pkg)

    if (ctx.state.skipInstall) return
    await run(pm, installArgs(pm), { cwd: ctx.projectDir, inherit: ctx.debug })
}

function computeStaleEnvKeys(ctx: RunContext, removedId: string): string[] {
    const removedKeys = new Set<string>()
    for (const v of collectEnvForFeature(ctx, removedId)) removedKeys.add(v.key)

    const keptKeys = new Set<string>()
    for (const id of ctx.enabledFeatures) {
        if (id === removedId) continue
        const vars: EnvVar[] = collectEnvForFeature(ctx, id)
        for (const v of vars) keptKeys.add(v.key)
    }
    return [...removedKeys].filter((k) => !keptKeys.has(k))
}

function splitSpec(spec: string): [string, string] {
    const lastAt = spec.lastIndexOf('@')
    if (lastAt > 0) return [spec.slice(0, lastAt), spec.slice(lastAt + 1)]
    return [spec, 'latest']
}

async function printAddHelp(registries: BattlestackRegistries): Promise<void> {
    const projectRoot = await findProjectRoot(process.cwd())
    if (!projectRoot) {
        console.log('Usage: battlestack add <feature-id>\n')
        console.log('(must be run inside a battlestack project)')
        return
    }
    const manifest = await readManifest(projectRoot, registries)
    if (!manifest) {
        console.log('Usage: battlestack add <feature-id>\n(no manifest found)')
        return
    }
    const template = registries.templates.get(manifest.template)
    // Same suggestion source as the error messages.
    const available = suggestable(manifest, template, registries)
        .split(', ')
        .filter((id) => id !== '(none)')

    ui.plain(ui.color.title('battlestack add <feature-id>'))
    ui.dim('Install one optional feature into the current project.')
    if (available.length === 0) {
        ui.blank()
        ui.dim('No optional features available to add.')
        return
    }
    ui.blank()
    ui.plain(ui.color.title('Available optional features'))
    ui.kv(
        available.map((id) => {
            const feature = registries.features.has(id) ? registries.features.get(id) : null
            return [id, feature?.label ?? id] as [string, string]
        }),
    )
    ui.blank()
}
