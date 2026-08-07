import prompts from 'prompts'
import { CLIError, ErrorCode, type BattlestackRegistries, type ParsedArgs, type Template } from '@battlestack/core'
import * as ui from './ui.js'

const onCancel = (): never => {
    throw new CLIError(ErrorCode.USER_ABORTED, 'Aborted by user')
}

/** True under `--yes`, `CI=true`, `CI_NON_INTERACTIVE=1`, or `npm_config_yes=true`. */
export function isNonInteractive(args: ParsedArgs): boolean {
    return (
        args.yes
        || process.env.CI === 'true'
        || process.env.CI_NON_INTERACTIVE === '1'
        || process.env.npm_config_yes === 'true'
    )
}

/** Literal match first, then the bare `userId` resolved via the registry. */
function idsMatch(templateId: string, userId: string, registries: BattlestackRegistries): boolean {
    if (templateId === userId) return true
    try {
        return templateId === registries.features.get(userId).fqid
    } catch {
        return false
    }
}

/** The optional feature set for a template. `--disable` wins over `--features`. */
export async function resolveOptionalFeatures(
    template: Template,
    args: ParsedArgs,
    registries: BattlestackRegistries,
): Promise<Set<string>> {
    const out = new Set<string>()
    const force = new Set(args.features ?? [])
    const block = new Set(args.disable ?? [])
    const defaults = new Set(template.defaultEnabledOptional ?? [])
    const nonInteractive = isNonInteractive(args)

    validateForcedFeatures(template, force, block, registries)

    const isBlocked = (id: string) => [...block].some((b) => idsMatch(id, b, registries))
    const isForced = (id: string) => [...force].some((f) => idsMatch(id, f, registries))

    for (const id of template.optionalFeatures) {
        if (isBlocked(id)) continue
        if (isForced(id)) out.add(id)
    }

    const promptable = template.optionalFeatures.filter((id) => !isBlocked(id) && !isForced(id))

    if (nonInteractive) {
        for (const id of promptable) {
            if (defaults.has(id)) out.add(id)
        }
        return out
    }

    for (const id of await promptOptionalFeatures(promptable, defaults, registries)) out.add(id)

    return out
}

function validateForcedFeatures(
    template: Template,
    force: ReadonlySet<string>,
    block: ReadonlySet<string>,
    registries: BattlestackRegistries,
): void {
    for (const id of force) {
        if (block.has(id)) {
            ui.warn(`${id} appears in both --features and --disable; treating as disabled`)
        } else if (!template.optionalFeatures.some((f) => idsMatch(f, id, registries))) {
            throw new CLIError(
                ErrorCode.UNSUPPORTED_FEATURE,
                `Feature "${id}" is not optional for template "${template.id}"`,
            )
        }
    }
}

async function promptOptionalFeatures(
    featureIds: string[],
    defaults: ReadonlySet<string>,
    registries: BattlestackRegistries,
): Promise<string[]> {
    if (featureIds.length === 0) return []

    const { enabled } = await prompts(
        {
            type: 'multiselect',
            name: 'enabled',
            message: 'Optional features',
            instructions: false,
            hint: 'space to toggle, enter to confirm',
            choices: featureIds.map((id) => {
                const feature = registries.features.get(id)
                return {
                    title: feature.label,
                    value: id,
                    description: feature.description,
                    selected: defaults.has(id),
                }
            }),
        },
        { onCancel },
    )
    return (enabled as string[] | undefined) ?? []
}

/** Final yes/no gate before disk writes. Auto-true under `--yes` and CI. */
export async function confirmProceed(args: ParsedArgs): Promise<boolean> {
    if (isNonInteractive(args)) return true
    const { go } = await prompts(
        {
            type: 'confirm',
            name: 'go',
            message: 'Proceed with these settings?',
            initial: true,
        },
        { onCancel },
    )
    return Boolean(go)
}

/** Lists the owned files `--overwrite` will clobber. Defaults to "no". Auto-true in CI. */
export async function confirmOverwriteOwned(
    args: ParsedArgs,
    atRisk: ReadonlyArray<{ featureId: string, files: readonly string[] }>,
): Promise<boolean> {
    if (atRisk.length === 0) return true
    if (isNonInteractive(args)) return true
    ui.warn('`--overwrite` will also reset these files you claimed with `battlestack own`:')
    for (const { featureId, files } of atRisk) {
        for (const rel of files) ui.bullet(`${rel}  (${featureId})`)
    }
    const { go } = await prompts(
        {
            type: 'confirm',
            name: 'go',
            message: 'Overwrite these owned files too?',
            initial: false,
        },
        { onCancel },
    )
    return Boolean(go)
}
