import path from 'node:path'
import {
    CLIError,
    ErrorCode,
    MANIFEST_PATH,
    migrateStateDir,
    resolvePackageManager,
    writeManifest,
    type CommandContext,
    type RunContext,
} from '@battlestack/core'
import { exists } from '@battlestack/core/utils/fs.js'
import {
    isNonInteractive,
    promptFramework,
    promptPackageManager,
    promptTemplate,
    resolveOptionalFeatures,
    ui,
} from '@battlestack/tui'

/** Adopts a directory into project mode by writing `.battlestack/manifest.json`. Hashes stay empty. */
export async function initCommand(context: CommandContext): Promise<void> {
    const { parsed: args, registries } = context
    const projectDir = args.cwd ? path.resolve(args.cwd) : process.cwd()
    // Runs before the manifest guard, which only checks the current-name path.
    await migrateStateDir(projectDir)
    const manifestAbs = path.join(projectDir, MANIFEST_PATH)

    if ((await exists(manifestAbs)) && !args.force) {
        throw new CLIError(
            ErrorCode.DIRECTORY_EXISTS,
            `${MANIFEST_PATH} already exists at ${projectDir}. Re-run with --force to overwrite.`,
        )
    }

    ui.section('battlestack init')
    ui.dim(`Adopting ${projectDir} into project mode (writes ${MANIFEST_PATH}).`)

    const framework = await promptFramework(registries, args.framework)

    // A non-interactive run cannot answer the template picker.
    const requestedTemplate = args.template ?? args.secondPositional
    const templatesForFramework = registries.templates.all().filter((t) => t.framework === framework.id)
    if (!requestedTemplate && isNonInteractive(args) && templatesForFramework.length > 1) {
        throw new CLIError(
            ErrorCode.UNKNOWN_TEMPLATE,
            `Multiple templates for "${framework.id}"; pass --template <id> in non-interactive mode.`,
        )
    }

    const template = await promptTemplate(registries, framework, requestedTemplate)
    if (template.framework !== framework.id) {
        throw new CLIError(
            ErrorCode.UNSUPPORTED_FEATURE,
            `Template "${template.id}" is not compatible with framework "${framework.id}"`,
        )
    }

    const enabled = new Set<string>(template.requiredFeatures)
    ui.section('Features')
    for (const id of await resolveOptionalFeatures(template, args, registries)) enabled.add(id)

    // Every id must exist and support the framework, as in `create`.
    for (const id of enabled) {
        if (!registries.features.has(id)) {
            throw new CLIError(ErrorCode.UNKNOWN_FEATURE, `Unknown feature: ${id}`)
        }
        const feature = registries.features.get(id)
        if (feature.frameworks && !feature.frameworks.includes(framework.id)) {
            throw new CLIError(
                ErrorCode.UNSUPPORTED_FEATURE,
                `Feature "${id}" does not support framework "${framework.id}"`,
            )
        }
    }

    const pm = await promptPackageManager({
        explicit: args.packageManager,
        detected: await resolvePackageManager(args.packageManager),
        yes: args.yes,
    })

    const ctx: RunContext = {
        projectName: path.basename(projectDir),
        projectDir,
        framework,
        template,
        enabledFeatures: enabled,
        state: { packageManager: pm },
        debug: args.debug,
        dryRun: args.dryRun,
        registries,
    }

    if (args.dryRun) {
        ui.info(`dry-run: would write ${MANIFEST_PATH} (${enabled.size} features, no file hashes)`)
        return
    }

    await writeManifest(ctx)

    ui.section('Done')
    ui.ok(`Wrote ${ui.color.accent(MANIFEST_PATH)}: ${enabled.size} features tracked`)
    ui.blank()
    ui.warn(
        'File hashes are empty (no scaffold ran). `battlestack doctor` / `battlestack pull` treat tracked files as new',
    )
    ui.hint('Run `battlestack` to list project commands, or `battlestack doctor` to inspect.')
    ui.blank()
}
