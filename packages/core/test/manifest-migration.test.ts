import { describe, expect, it } from 'vitest'
import { migrateManifest } from '../src/manifest.js'
import { BattlestackRegistries } from '../src/registry.js'
import { STAGE } from '../src/constants/stages.js'
import type { Feature } from '../src/types/feature.js'
import type { ProjectManifest } from '../src/types/project-manifest.js'

// Mirrors production: preset-nuxt4 registers under an explicit `nuxt4` namespace, so
// `nuxt4:database` becomes `nuxt4:nuxt4:database` and `shared:docker` gains the prefix.
const nuxt4Origin = { plugin: '@battlestack/preset-nuxt4', namespace: 'nuxt4' }

const fakeFeature = (id: string): Feature => ({
    id,
    version: '1.0.0',
    label: id,
    stage: STAGE.STYLING,
    async execute() {},
})

function registriesWithNuxt4(): BattlestackRegistries {
    const r = new BattlestackRegistries()
    r.features.register(fakeFeature('nuxt4:database'), nuxt4Origin)
    r.features.register(fakeFeature('shared:docker'), nuxt4Origin)
    return r
}

function legacyManifest(over: Partial<ProjectManifest> = {}): ProjectManifest {
    return {
        schemaVersion: 1,
        cliVersion: '2.3.8',
        framework: 'nuxt',
        template: 'nuxt-fullstack',
        packageManager: 'pnpm',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        features: [
            { id: 'nuxt:database', version: '1.0.0', files: {} },
            { id: 'shared:docker', version: '1.0.0', files: {} },
        ],
        ...over,
    }
}

describe('migrateManifest: legacy → nuxt4', () => {
    it('bumps the unversioned framework to nuxt4', () => {
        const m = legacyManifest()
        expect(migrateManifest(m, registriesWithNuxt4())).toBe(true)
        expect(m.framework).toBe('nuxt4')
    })

    it('canonicalizes legacy feature ids to nuxt4 fqids when registries are supplied', () => {
        const m = legacyManifest()
        migrateManifest(m, registriesWithNuxt4())
        expect(m.features.map((f) => f.id)).toEqual([
            'nuxt4:nuxt4:database',
            'nuxt4:shared:docker',
        ])
    })

    it('string-only bump when no registries (domain nuxt:→nuxt4:, stays resolvable)', () => {
        const m = legacyManifest()
        expect(migrateManifest(m)).toBe(true)
        expect(m.framework).toBe('nuxt4')
        expect(m.features.map((f) => f.id)).toEqual(['nuxt4:database', 'shared:docker'])
    })

    it('migrates optedOut ids', () => {
        const m = legacyManifest({ optedOut: ['nuxt:storage'] })
        migrateManifest(m, registriesWithNuxt4())
        // 'nuxt:storage' has no registered feature here → bumped bare form.
        expect(m.optedOut).toEqual(['nuxt4:storage'])
    })

    // Barrier TWO against `pull` resurrecting a removed feature: a bare `optedOut` entry
    // on disk is canonicalized on read. The end-to-end test cannot pin this one alone.
    it('canonicalizes an already-bare optedOut id to its fqid when registries are supplied', () => {
        const m = legacyManifest({ optedOut: ['shared:docker'] })
        migrateManifest(m, registriesWithNuxt4())
        expect(m.optedOut).toEqual(['nuxt4:shared:docker'])
    })

    it('is idempotent: a nuxt4 manifest is left untouched', () => {
        const m = legacyManifest({
            framework: 'nuxt4',
            features: [{ id: 'nuxt4:nuxt4:database', version: '1.0.0', files: {} }],
        })
        expect(migrateManifest(m, registriesWithNuxt4())).toBe(false)
        expect(m.framework).toBe('nuxt4')
        expect(m.features[0]!.id).toBe('nuxt4:nuxt4:database')
    })

    it('NEVER touches a v5 manifest: pinning is v4-only, upgrade is explicit', () => {
        const m = legacyManifest({
            framework: 'nuxt5',
            template: 'nuxt5-fullstack',
            features: [{ id: 'nuxt5:nuxt5:database', version: '1.0.0', files: {} }],
        })
        expect(migrateManifest(m, registriesWithNuxt4())).toBe(false)
        expect(m.framework).toBe('nuxt5')
        expect(m.features[0]!.id).toBe('nuxt5:nuxt5:database')
    })
})
