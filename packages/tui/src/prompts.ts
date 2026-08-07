import prompts from 'prompts'
import { CLIError, ErrorCode, type BattlestackRegistries, type Framework, type PackageManager, type Template } from '@battlestack/core'

/** Templates registered for a given framework. */
function templatesForFramework(registries: BattlestackRegistries, frameworkId: string): Template[] {
    return registries.templates.all().filter((t) => t.framework === frameworkId)
}

const onCancel = () => {
    throw new CLIError(ErrorCode.USER_ABORTED, 'Aborted by user')
}

export async function promptProjectName(initial?: string, yes = false): Promise<string> {
    if (initial) return initial
    if (yes) return 'cool-new-project'
    const { name } = await prompts(
        {
            type: 'text',
            name: 'name',
            message: 'Project name',
            initial: 'cool-new-project',
        },
        { onCancel },
    )
    return name as string
}

export async function promptFramework(registries: BattlestackRegistries, initial?: string): Promise<Framework> {
    const all = registries.frameworks.all()
    if (initial) return registries.frameworks.get(initial)
    if (all.length === 1) return all[0]!
    const { id } = await prompts(
        {
            type: 'select',
            name: 'id',
            message: 'Framework',
            choices: all.map((f) => ({
                title: f.label,
                value: f.id,
                description: f.description,
            })),
        },
        { onCancel },
    )
    return registries.frameworks.get(id as string)
}

export async function promptTemplate(
    registries: BattlestackRegistries,
    framework: Framework,
    initial?: string,
): Promise<Template> {
    const choices = templatesForFramework(registries, framework.id)
    if (choices.length === 0) {
        throw new CLIError(
            ErrorCode.UNKNOWN_TEMPLATE,
            `No templates registered for framework "${framework.id}"`,
        )
    }
    if (initial) return registries.templates.get(initial)
    if (choices.length === 1) return choices[0]!
    const { id } = await prompts(
        {
            type: 'select',
            name: 'id',
            message: 'Template',
            choices: choices.map((t) => ({
                title: t.label,
                value: t.id,
                description: t.description,
            })),
        },
        { onCancel },
    )
    return registries.templates.get(id as string)
}

export async function promptGateway(initial?: boolean): Promise<boolean> {
    // No prompt. Off by default; `--gateway` or `.battlestack/local.json` opts in.
    return initial === true
}

interface PromptPMOpts {
    /** `--pm <x>` override; skips the prompt entirely. */
    explicit?: PackageManager
    /** Detected default from `npm_config_user_agent`; pre-selected in the picker. */
    detected?: PackageManager
    /** Auto-accept the detected default. */
    yes?: boolean
}

export async function promptPackageManager(
    opts: PromptPMOpts = {},
): Promise<PackageManager> {
    // No prompt. Default project PM is pnpm; `--pm <bun|npm>` overrides.
    return opts.explicit ?? 'pnpm'
}
