import type { DeployTarget, Feature, Framework, Template, TemplateExtension, BattlestackCommand } from './types.js'
import type { BattlestackRegistries } from './registry.js'

export const BATTLESTACK_PLUGIN_API_VERSION = 1

export interface BattlestackPluginContext {
    addFeature(feature: Feature): void
    addFramework(framework: Framework): void
    addTemplate(template: Template): void
    /** Applied after every plugin loads. An unknown template warns and is skipped. */
    extendTemplate(extension: TemplateExtension): void
    /** `battlestack <id>`, listed in `battlestack help`. Built-in commands take precedence. */
    addCommand(command: BattlestackCommand): void
    addDeployTarget(target: DeployTarget): void
}

export interface BattlestackPlugin {
    name: string
    apiVersion: number
    /** Leading segment of `<namespace>:<domain>:<feature>`. Defaults to the package scope, else the name. */
    namespace?: string
    register(battlestack: BattlestackPluginContext): void
}

export function defineBattlestackPlugin(plugin: BattlestackPlugin): BattlestackPlugin {
    return plugin
}

/** `@scope/pkg` → `scope`; `pkg` → `pkg`. */
export function defaultNamespace(name: string): string {
    const scoped = /^@([^/]+)\//.exec(name)
    return scoped ? scoped[1] : name
}

/** One fqid segment: npm-style package-name characters, no `:`. */
const SINGLE_FQID_SEGMENT_RE = /^[a-z0-9][a-z0-9._-]*$/

export interface PendingExtension extends TemplateExtension {
    requestedByPlugin: string
}

export interface LoadedPlugin {
    name: string
    /** bundled, store, env or project. */
    via: string
    extensions: PendingExtension[]
}

export function applyPlugin(plugin: BattlestackPlugin, via: string, registries: BattlestackRegistries): LoadedPlugin {
    if (Math.trunc(plugin.apiVersion) !== BATTLESTACK_PLUGIN_API_VERSION) {
        throw new Error(
            `${plugin.name} targets plugin API v${plugin.apiVersion}, `
            + `this CLI provides v${BATTLESTACK_PLUGIN_API_VERSION}; update the plugin or the CLI.`,
        )
    }
    const namespace = plugin.namespace ?? defaultNamespace(plugin.name)
    if (!SINGLE_FQID_SEGMENT_RE.test(namespace)) {
        throw new Error(
            `${plugin.name}: invalid namespace "${namespace}"; use a lowercase slug (no ":" or "/")`,
        )
    }
    const origin = { plugin: plugin.name, namespace }
    const loaded: LoadedPlugin = { name: plugin.name, via, extensions: [] }
    plugin.register({
        addFeature: (f) => registries.features.register(f, origin),
        addFramework: (f) => registries.frameworks.register(f, origin),
        addTemplate: (t) => registries.templates.register(t, origin),
        extendTemplate: (ext) => loaded.extensions.push({ ...ext, requestedByPlugin: plugin.name }),
        addCommand: (c) => registries.commands.register(c, origin),
        addDeployTarget: (t) => registries.deployTargets.register(t, origin),
    })
    return loaded
}

/** What a field holds, for fqid canonicalization. */
type IdRole =
    /** Canonicalized to fqids. Unregistered or ambiguous entries are dropped with a warning. */
    | 'featureIds'
    /** A subset of the same template's already-canonicalized `optionalFeatures`. */
    | 'featureIdsWithinOptional'
    /** Ids advertised as possible, not as registered. Unresolvable ones are kept verbatim. */
    | 'featureIdCatalog'
    /** Left bare. Never canonicalized. */
    | 'bareFeatureIds'
    /** Framework id, left bare. */
    | 'frameworkId'
    /** Holds no id: labels, descriptions, versions, callbacks, and an entity's own `id`. */
    | 'opaque'

/** The roles `finalizeRegistries` rewrites and `assertFeatureIdsCanonical` polices. */
type FeatureIdRole = 'featureIds' | 'featureIdsWithinOptional' | 'featureIdCatalog'

/** Roles that only make sense on a `string[]` field. */
type ArrayIdRole = FeatureIdRole | 'bareFeatureIds'

/** Exhaustive, role-appropriate classification of one entity type's fields. */
type IdRoleTable<T> = {
    [K in keyof Required<T>]: string[] extends NonNullable<Required<T>[K]>
        ? IdRole
        : Exclude<IdRole, ArrayIdRole>
}

const TEMPLATE_ID_ROLES = {
    id: 'opaque',
    label: 'opaque',
    description: 'opaque',
    framework: 'frameworkId',
    requiredFeatures: 'featureIds',
    optionalFeatures: 'featureIds',
    defaultEnabledOptional: 'featureIdsWithinOptional',
} satisfies IdRoleTable<Template>

const FRAMEWORK_ID_ROLES = {
    id: 'opaque',
    label: 'opaque',
    description: 'opaque',
    supportedFeatures: 'featureIdCatalog',
} satisfies IdRoleTable<Framework>

const FEATURE_ID_ROLES = {
    id: 'opaque',
    label: 'opaque',
    description: 'opaque',
    frameworks: 'frameworkId',
    stage: 'opaque',
    before: 'bareFeatureIds',
    after: 'bareFeatureIds',
    version: 'opaque',
    requires: 'bareFeatureIds',
    failureIsNonFatal: 'opaque',
    upgradable: 'opaque',
    collectDeps: 'opaque',
    collectModules: 'opaque',
    collectSkills: 'opaque',
    projectCommands: 'opaque',
    preCheck: 'opaque',
    collectEnv: 'opaque',
    collectDocs: 'opaque',
    collectBuildSecrets: 'opaque',
    structuralFiles: 'opaque',
    prompt: 'opaque',
    execute: 'opaque',
    update: 'opaque',
} satisfies IdRoleTable<Feature>

/** Keys of `T` whose value is a string array, ignoring optionality. */
type StringArrayFieldOf<T> = {
    [K in keyof Required<T>]-?: string[] extends NonNullable<Required<T>[K]> ? K : never
}[keyof Required<T>]

/** The field names carrying `role`, read off a role table. */
function fieldsWithRole<T>(roles: IdRoleTable<T>, role: ArrayIdRole): Array<StringArrayFieldOf<T>> {
    return (Object.keys(roles) as Array<keyof Required<T>>)
        .filter((key) => roles[key] === role) as Array<StringArrayFieldOf<T>>
}

/** Throws unless every `featureIds`/`featureIdsWithinOptional` entry resolves to itself. */
function assertFeatureIdsCanonical<T>(
    entity: T & { fqid: string },
    roles: IdRoleTable<T>,
    kind: string,
    registries: BattlestackRegistries,
): void {
    for (const role of ['featureIds', 'featureIdsWithinOptional'] as const) {
        for (const field of fieldsWithRole(roles, role)) {
            for (const id of (entity[field] as string[] | undefined) ?? []) {
                let canonical: string | null = null
                try {
                    canonical = registries.features.get(id).fqid
                } catch {
                    canonical = null
                }
                if (canonical !== id) {
                    throw new Error(
                        `battlestack internal invariant: ${kind} "${entity.fqid}" field `
                        + `"${String(field)}" (role ${role}) still holds "${id}" after finalizeRegistries; `
                        + 'expected a fully-qualified feature id. Every id-bearing field must be '
                        + 'canonicalized by the pass driven from its IdRole classification.',
                    )
                }
            }
        }
    }
}

/** Applies extensions, canonicalizes id fields per `IdRole`, seals. Unresolvable ids warn. */
export function finalizeRegistries(
    registries: BattlestackRegistries,
    extensions: PendingExtension[],
): string[] {
    const warnings: string[] = []
    const resolveFeature = (id: string, requestedBy: string, templateFqid: string): string | null => {
        try {
            return registries.features.get(id).fqid
        } catch (err) {
            warnings.push(
                `${requestedBy}: feature "${id}" in template "${templateFqid}" dropped: `
                + (err instanceof Error ? err.message : String(err)),
            )
            return null
        }
    }
    const canonicalize = (ids: string[], requestedBy: string, templateFqid: string): string[] =>
        [...new Set(
            ids
                .map((id) => resolveFeature(id, requestedBy, templateFqid))
                .filter((id): id is string => id !== null),
        )]

    /** Matches against the already-canonicalized `optionalFeatures`. A non-optional match warns. */
    const canonicalizeDefaultEnabled = (
        ids: string[],
        canonicalOptional: string[],
        template: { origin: { plugin: string }, fqid: string },
    ): string[] => {
        const resolved: string[] = []
        const seen = new Set<string>()
        for (const id of ids) {
            let fqid: string
            try {
                fqid = registries.features.get(id).fqid
            } catch {
                continue
            }
            if (seen.has(fqid)) continue
            if (canonicalOptional.includes(fqid)) {
                seen.add(fqid)
                resolved.push(fqid)
            } else {
                warnings.push(
                    `${template.origin.plugin}: defaultEnabledOptional "${id}" in template "${template.fqid}" `
                    + `resolves to "${fqid}", which is not in this template's optionalFeatures, so dropped`,
                )
            }
        }
        return resolved
    }

    /** Unresolvable ids are kept as authored and not warned. Ambiguous ids warn. */
    const canonicalizeCatalog = (
        ids: string[],
        owner: { origin: { plugin: string }, fqid: string },
    ): string[] =>
        [...new Set(ids.map((id) => {
            try {
                return registries.features.get(id).fqid
            } catch (err) {
                if (registries.features.has(id)) {
                    warnings.push(
                        `${owner.origin.plugin}: feature "${id}" advertised by framework "${owner.fqid}" `
                        + 'is ambiguous, left unqualified: '
                        + (err instanceof Error ? err.message : String(err)),
                    )
                }
                return id
            }
        }))]

    for (const template of registries.templates.all()) {
        for (const field of fieldsWithRole<Template>(TEMPLATE_ID_ROLES, 'featureIds')) {
            const ids = template[field]
            if (ids) template[field] = canonicalize(ids, template.origin.plugin, template.fqid)
        }
        for (const field of fieldsWithRole<Template>(TEMPLATE_ID_ROLES, 'featureIdsWithinOptional')) {
            const ids = template[field]
            if (ids) template[field] = canonicalizeDefaultEnabled(ids, template.optionalFeatures, template)
        }
    }

    for (const framework of registries.frameworks.all()) {
        for (const field of fieldsWithRole<Framework>(FRAMEWORK_ID_ROLES, 'featureIdCatalog')) {
            const ids = framework[field]
            if (ids) framework[field] = canonicalizeCatalog(ids, framework)
        }
    }

    for (const ext of extensions) {
        let template
        try {
            template = registries.templates.get(ext.templateId)
        } catch (err) {
            warnings.push(
                `${ext.requestedByPlugin} extends template "${ext.templateId}", skipped: `
                + (err instanceof Error ? err.message : String(err)),
            )
            continue
        }
        for (const featureId of ext.addFeatures ?? []) {
            const fqid = resolveFeature(featureId, ext.requestedByPlugin, template.fqid)
            if (fqid && !template.requiredFeatures.includes(fqid) && !template.optionalFeatures.includes(fqid)) {
                template.requiredFeatures.push(fqid)
            }
        }
        for (const featureId of ext.addOptionalFeatures ?? []) {
            const fqid = resolveFeature(featureId, ext.requestedByPlugin, template.fqid)
            if (fqid && !template.requiredFeatures.includes(fqid) && !template.optionalFeatures.includes(fqid)) {
                template.optionalFeatures.push(fqid)
            }
        }
    }

    for (const template of registries.templates.all()) {
        assertFeatureIdsCanonical<Template>(template, TEMPLATE_ID_ROLES, 'template', registries)
    }
    for (const framework of registries.frameworks.all()) {
        assertFeatureIdsCanonical<Framework>(framework, FRAMEWORK_ID_ROLES, 'framework', registries)
    }
    for (const feature of registries.features.all()) {
        assertFeatureIdsCanonical<Feature>(feature, FEATURE_ID_ROLES, 'feature', registries)
    }

    registries.seal()
    return warnings
}
