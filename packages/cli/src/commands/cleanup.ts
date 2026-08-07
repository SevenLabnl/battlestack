import path from 'node:path'
import { readdir, rm } from 'node:fs/promises'
import prompts from 'prompts'
import type { Ora } from 'ora'
import { ui } from '@battlestack/tui'
import {
    CLIError,
    ErrorCode,
    exists,
    findProjectRoot,
    MANIFEST_PATH,
    readManifest,
    run,
    writeJson,
    type ParsedArgs,
    type ProjectManifest,
    type ReservedCommand,
} from '@battlestack/core'

export const cleanupReservedMeta: Omit<ReservedCommand, 'run'> = {
    name: 'cleanup',
    usage: 'battlestack cleanup [old-name]',
    label: 'interactive cleanup: pull artefacts, stale records, detached docker',
    group: 'Discovery',
}

const onCancel = () => {
    throw new CLIError(ErrorCode.USER_ABORTED, 'Aborted by user')
}

// `.battlestack.*` artefact suffixes. Duplicated in pull.ts and add-remove.ts.
const ARTEFACT_SUFFIXES = ['.battlestack.bak', '.battlestack.new', '.battlestack.patch', '.battlestack']

/** Where `battlestack pull` stages pending merges (relative to project root). */
const PULL_STAGE_DIR = path.join('.battlestack', 'pull')

/** Build output, deps, VCS internals and battlestack's own state dir. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.output', '.nuxt', '.mastra', 'dist', 'coverage', '.battlestack'])

/**
 * Interactive removal of `pull` artefacts, manifest records whose file is gone, and docker
 * resources keyed to a prior directory name. Opt-in per item; volumes double-confirm.
 */
export async function cleanupCommand(args: ParsedArgs, loader: Ora): Promise<void> {
    loader.stop()
    const projectRoot = await findProjectRoot(args.cwd ?? process.cwd())
    if (!projectRoot) {
        throw new CLIError(ErrorCode.SCAFFOLD_FAILED, 'Not inside a battlestack project (no .battlestack/manifest.json found)')
    }
    const manifest = await readManifest(projectRoot)
    if (!manifest) {
        throw new CLIError(ErrorCode.SCAFFOLD_FAILED, `No manifest at ${projectRoot}/${MANIFEST_PATH}`)
    }

    const interactive = process.stdout.isTTY === true
    if (!interactive && !args.dryRun) {
        ui.warn('cleanup is interactive; re-run from a TTY, or pass --dry-run for a report')
        return
    }

    let acted = false
    acted = (await cleanupArtefacts(projectRoot, args)) || acted
    acted = (await cleanupStaleRecords(projectRoot, manifest, args)) || acted
    acted = (await cleanupDockerLeftovers(projectRoot, manifest, args)) || acted

    if (!acted) ui.ok('Nothing to clean up')
}

/** Staged merges under `.battlestack/pull/`, plus legacy in-tree `*.battlestack*` files. */
export async function findBattlestackArtefacts(root: string, dir = root): Promise<string[]> {
    const out: string[] = []
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
        const abs = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue
            out.push(...(await findBattlestackArtefacts(root, abs)))
        } else if (ARTEFACT_SUFFIXES.some((s) => entry.name.endsWith(s))) {
            out.push(path.relative(root, abs))
        }
    }
    return out
}

/** Every file staged under `.battlestack/pull/`, relative to root. */
export async function findStagedArtefacts(root: string, dir?: string): Promise<string[]> {
    const base = dir ?? path.join(root, PULL_STAGE_DIR)
    const out: string[] = []
    const entries = await readdir(base, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
        const abs = path.join(base, entry.name)
        if (entry.isDirectory()) {
            out.push(...(await findStagedArtefacts(root, abs)))
        } else {
            out.push(path.relative(root, abs))
        }
    }
    return out
}

async function cleanupArtefacts(projectRoot: string, args: ParsedArgs): Promise<boolean> {
    const staged = await findStagedArtefacts(projectRoot)
    const legacy = await findBattlestackArtefacts(projectRoot)
    const artefacts = [...staged, ...legacy]
    if (artefacts.length === 0) return false

    ui.section('battlestack pull artefacts')
    if (args.dryRun) {
        ui.kv(artefacts.map((a) => [a, 'would prompt for deletion'] as [string, string]))
        return true
    }
    const { picked } = await prompts(
        {
            type: 'multiselect',
            name: 'picked',
            message: 'Select artefact files to delete (space to toggle, enter to confirm)',
            choices: artefacts.map((a) => ({ title: a, value: a, selected: false })),
            hint: 'review .battlestack/pull/*.patch contents before deleting; they hold un-merged updates',
        },
        { onCancel },
    )
    for (const rel of (picked as string[] | undefined) ?? []) {
        await rm(path.join(projectRoot, rel), { force: true })
        ui.ok(`deleted ${rel}`)
    }
    return true
}

/** Manifest file records whose path no longer exists on disk. */
export async function findStaleRecords(
    projectRoot: string,
    manifest: ProjectManifest,
): Promise<Array<{ featureId: string, rel: string }>> {
    const stale: Array<{ featureId: string, rel: string }> = []
    for (const feature of manifest.features) {
        for (const rel of Object.keys(feature.files)) {
            if (!(await exists(path.join(projectRoot, rel)))) {
                stale.push({ featureId: feature.id, rel })
            }
        }
    }
    return stale
}

async function cleanupStaleRecords(
    projectRoot: string,
    manifest: ProjectManifest,
    args: ParsedArgs,
): Promise<boolean> {
    const stale = await findStaleRecords(projectRoot, manifest)
    if (stale.length === 0) return false

    ui.section('Stale manifest records (file gone from disk)')
    ui.kv(stale.map((s) => [s.rel, s.featureId] as [string, string]))
    if (args.dryRun) return true

    const { confirm } = await prompts(
        {
            type: 'confirm',
            name: 'confirm',
            message: `Prune ${stale.length} record(s) from .battlestack/manifest.json? (the next \`battlestack pull\` may re-emit those files)`,
            initial: false,
        },
        { onCancel },
    )
    if (confirm !== true) return true

    const staleByFeature = new Map<string, Set<string>>()
    for (const { featureId, rel } of stale) {
        const set = staleByFeature.get(featureId) ?? new Set<string>()
        set.add(rel)
        staleByFeature.set(featureId, set)
    }
    for (const record of manifest.features) {
        const gone = staleByFeature.get(record.id)
        if (!gone) continue
        record.files = Object.fromEntries(
            Object.entries(record.files).filter(([rel]) => !gone.has(rel)),
        )
    }
    manifest.updatedAt = new Date().toISOString()
    await writeJson(path.join(projectRoot, MANIFEST_PATH), manifest)
    ui.ok(`pruned ${stale.length} record(s)`)
    return true
}

interface DockerLeftovers {
    name: string
    containers: string[]
    volumes: string[]
    networks: string[]
}

/** Docker resources labelled with a previous compose project name. */
async function findDockerLeftovers(name: string): Promise<DockerLeftovers> {
    const list = async (cmd: string[]): Promise<string[]> => {
        try {
            const result = await run('docker', cmd, { inherit: false })
            return result.stdout.split('\n').map((s: string) => s.trim()).filter(Boolean)
        } catch {
            return []
        }
    }
    const label = `label=com.docker.compose.project=${name}`
    return {
        name,
        containers: await list(['ps', '-a', '--filter', label, '--format', '{{.Names}}']),
        volumes: await list(['volume', 'ls', '--filter', label, '--format', '{{.Name}}']),
        networks: await list(['network', 'ls', '--filter', label, '--format', '{{.Name}}']),
    }
}

async function cleanupDockerLeftovers(
    projectRoot: string,
    manifest: ProjectManifest,
    args: ParsedArgs,
): Promise<boolean> {
    const current = path.basename(projectRoot)
    const names = new Set(manifest.previousNames ?? [])
    // Escape hatch for renames predating the `previousNames` field.
    const positional = String(args.secondPositional ?? '').trim()
    if (positional) names.add(positional)
    names.delete(current)
    if (names.size === 0) return false

    let acted = false
    for (const name of names) {
        const leftovers = await findDockerLeftovers(name)
        const total = leftovers.containers.length + leftovers.volumes.length + leftovers.networks.length
        if (total === 0) continue
        acted = true

        ui.section(`Detached docker resources (project: ${name})`)
        const rows: Array<[string, string]> = [
            ...leftovers.containers.map((c) => [c, 'container'] as [string, string]),
            ...leftovers.volumes.map((v) => [v, 'volume (holds data!)'] as [string, string]),
            ...leftovers.networks.map((n) => [n, 'network'] as [string, string]),
        ]
        ui.kv(rows)
        if (args.dryRun) continue

        const { picked } = await prompts(
            {
                type: 'multiselect',
                name: 'picked',
                message: `Select resources of "${name}" to remove`,
                choices: [
                    ...leftovers.containers.map((c) => ({ title: `container ${c}`, value: `container:${c}`, selected: false })),
                    ...leftovers.volumes.map((v) => ({ title: `volume ${v} (DELETES DATA)`, value: `volume:${v}`, selected: false })),
                    ...leftovers.networks.map((n) => ({ title: `network ${n}`, value: `network:${n}`, selected: false })),
                ],
            },
            { onCancel },
        )
        const selections = (picked as string[] | undefined) ?? []

        // Volumes hold databases and uploads.
        const volumes = selections.filter((s) => s.startsWith('volume:'))
        if (volumes.length > 0) {
            const { sure } = await prompts(
                {
                    type: 'confirm',
                    name: 'sure',
                    message: `Really delete ${volumes.length} volume(s)? Data inside is gone for good.`,
                    initial: false,
                },
                { onCancel },
            )
            if (sure !== true) {
                ui.skip('volumes kept')
                selections.splice(0, selections.length, ...selections.filter((s) => !s.startsWith('volume:')))
            }
        }

        // Containers first: volumes and networks stay in use until they are gone.
        const order = ['container', 'volume', 'network']
        const sorted = [...selections].sort(
            (a, b) => order.indexOf(a.split(':')[0]!) - order.indexOf(b.split(':')[0]!),
        )
        for (const sel of sorted) {
            const [kind, ...rest] = sel.split(':')
            const id = rest.join(':')
            const cmd = kind === 'container' ? ['rm', id] : kind === 'volume' ? ['volume', 'rm', id] : ['network', 'rm', id]
            try {
                await run('docker', cmd, { inherit: false })
                ui.ok(`removed ${kind} ${id}`)
            } catch (err) {
                ui.warn(`could not remove ${kind} ${id}: ${(err as Error).message ?? 'still in use?'}`)
            }
        }
    }
    return acted
}
