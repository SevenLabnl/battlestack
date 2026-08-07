import type { DeployTarget, Feature, Framework, Provenance, Template, BattlestackCommand } from './types.js'

/** A registered entity plus loader-assigned provenance and its fully-qualified id. */
export type Registered<T> = T & { origin: Provenance; fqid: string }

/** Id-keyed registry. A bare authored id also gets an fqid, and resolves only when unique. */
export class Registry<T extends { id: string }> {
    private readonly byFqid = new Map<string, Registered<T>>()
    private readonly byBare = new Map<string, Registered<T>[]>()
    private sealed = false

    /** An authored id's exact `:`-segment count: 2 for `<domain>:<feature>`, 1 for plain slugs. */
    constructor(private readonly kind: string, private readonly idSegments: number) {}

    register(entity: T, origin: Provenance): void {
        if (this.sealed) {
            throw new Error(`${this.kind} registry is sealed; plugins can only register during load`)
        }
        if (entity.id.split(':').length !== this.idSegments) {
            const shape = this.idSegments === 1 ? 'a plain slug without ":"' : '"<domain>:<name>"'
            throw new Error(
                `Invalid ${this.kind.toLowerCase()} id "${entity.id}" from ${origin.plugin}; expected ${shape}`,
            )
        }
        const fqid = `${origin.namespace}:${entity.id}`
        const prev = this.byFqid.get(fqid)
        if (prev) {
            throw new Error(
                `${this.kind} "${fqid}" already registered by ${prev.origin.plugin} `
                + `(duplicate from ${origin.plugin})`,
            )
        }
        // Copied so the registry never aliases the plugin module's own object.
        const record = { ...entity, origin, fqid } as Registered<T>
        this.byFqid.set(fqid, record)
        const bucket = this.byBare.get(entity.id)
        if (bucket) bucket.push(record)
        else this.byBare.set(entity.id, [record])
    }

    get(id: string): Registered<T> {
        const qualified = this.byFqid.get(id)
        if (qualified) return qualified

        const bucket = this.byBare.get(id)
        if (!bucket || bucket.length === 0) {
            throw new Error(`Unknown ${this.kind.toLowerCase()}: ${id}`)
        }
        if (bucket.length > 1) {
            const candidates = bucket.map((r) => r.fqid).join(', ')
            throw new Error(
                `Ambiguous ${this.kind.toLowerCase()} "${id}", provided by `
                + `${candidates}. Qualify it with the plugin namespace.`,
            )
        }
        return bucket[0]
    }

    has(id: string): boolean {
        return this.byFqid.has(id) || (this.byBare.get(id)?.length ?? 0) > 0
    }

    all(): Registered<T>[] {
        return [...this.byFqid.values()]
    }

    /** Reject any further `register()`; called once the loader has finalized. */
    seal(): void {
        this.sealed = true
    }
}

export class BattlestackRegistries {
    readonly features = new Registry<Feature>('Feature', 2)
    readonly frameworks = new Registry<Framework>('Framework', 1)
    readonly templates = new Registry<Template>('Template', 1)
    readonly deployTargets = new Registry<DeployTarget>('DeployTarget', 1)
    readonly commands = new Registry<BattlestackCommand>('Command', 1)

    seal(): void {
        this.features.seal()
        this.frameworks.seal()
        this.templates.seal()
        this.deployTargets.seal()
        this.commands.seal()
    }
}
