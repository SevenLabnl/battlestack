import { STAGE } from '../src/constants/stages.js'
import { describe, expect, it } from 'vitest'
import { BattlestackRegistries } from '../src/registry.js'
import { resolveExecutionOrder } from '../src/orchestrator.js'
import type { Stage } from '../src/types/stage.js'
import type { Feature } from '../src/types/feature.js'
import type { RunContext } from '../src/types/run-context.js'

const origin = { plugin: 'test-plugin', namespace: 'test' }

const mk = (
    id: string,
    stage: Stage,
    extras: Partial<Pick<Feature, 'requires' | 'before' | 'after' | 'frameworks'>> = {},
): Feature => ({
    id,
    version: '0.1.0',
    label: id,
    stage,
    ...extras,
    async execute() {},
})

function setup(): BattlestackRegistries {
    const registries = new BattlestackRegistries()
    registries.frameworks.register({ id: 'orch-test', label: 'orch-test', supportedFeatures: [] }, origin)
    registries.templates.register({
        id: 'orch-test', label: 'orch-test', framework: 'orch-test', requiredFeatures: [], optionalFeatures: [],
    }, origin)
    return registries
}

function fakeCtx(registries: BattlestackRegistries, enabled: string[]): RunContext {
    return {
        projectName: 'test',
        projectDir: '/tmp/test',
        framework: registries.frameworks.get('orch-test'),
        template: registries.templates.get('orch-test'),
        enabledFeatures: new Set(enabled),
        state: {},
        debug: false,
        dryRun: true,
        registries,
    }
}

describe('resolveExecutionOrder', () => {
    it('orders by stage', () => {
        const registries = setup()
        registries.features.register(mk('test:orch-low', 'FINALIZE'), origin)
        registries.features.register(mk('test:orch-mid', 'STYLING'), origin)
        registries.features.register(mk('test:orch-high', 'SCAFFOLD'), origin)

        const ctx = fakeCtx(registries, ['test:orch-low', 'test:orch-mid', 'test:orch-high'])
        const ordered = resolveExecutionOrder(ctx).map((f) => f.id)

        expect(ordered).toEqual(['test:orch-high', 'test:orch-mid', 'test:orch-low'])
    })

    it('respects requires (topo) across stage boundaries', () => {
        // dep is in a later stage, but `requires` should pull it earlier.
        const registries = setup()
        registries.features.register(mk('test:orch-dep', 'FINALIZE'), origin)
        registries.features.register(mk('test:orch-dependent', 'SCAFFOLD', { requires: ['test:orch-dep'] }), origin)

        const ctx = fakeCtx(registries, ['test:orch-dep', 'test:orch-dependent'])
        const ordered = resolveExecutionOrder(ctx).map((f) => f.id)

        const depIdx = ordered.indexOf('test:orch-dep')
        const dependentIdx = ordered.indexOf('test:orch-dependent')
        expect(depIdx).toBeLessThan(dependentIdx)
    })

    it('respects `after` hint within a stage', () => {
        const registries = setup()
        registries.features.register(mk('test:orch-after-a', 'STYLING'), origin)
        registries.features.register(
            mk('test:orch-after-b', 'STYLING', { after: ['test:orch-after-a'] }),
            origin,
        )

        const ctx = fakeCtx(registries, ['test:orch-after-a', 'test:orch-after-b'])
        const ordered = resolveExecutionOrder(ctx).map((f) => f.id)

        expect(ordered.indexOf('test:orch-after-a')).toBeLessThan(
            ordered.indexOf('test:orch-after-b'),
        )
    })

    it('respects `before` hint within a stage', () => {
        const registries = setup()
        registries.features.register(
            mk('test:orch-before-a', 'STYLING', { before: ['test:orch-before-b'] }),
            origin,
        )
        registries.features.register(mk('test:orch-before-b', 'STYLING'), origin)

        const ctx = fakeCtx(registries, ['test:orch-before-a', 'test:orch-before-b'])
        const ordered = resolveExecutionOrder(ctx).map((f) => f.id)

        expect(ordered.indexOf('test:orch-before-a')).toBeLessThan(
            ordered.indexOf('test:orch-before-b'),
        )
    })

    it('throws on cyclic deps', () => {
        const registries = setup()
        registries.features.register(mk('test:orch-cyc-a', 'STYLING', { requires: ['test:orch-cyc-b'] }), origin)
        registries.features.register(mk('test:orch-cyc-b', 'STYLING', { requires: ['test:orch-cyc-a'] }), origin)

        const ctx = fakeCtx(registries, ['test:orch-cyc-a', 'test:orch-cyc-b'])
        expect(() => resolveExecutionOrder(ctx)).toThrow(/Cyclic/)
    })

    it('skips features whose framework constraint excludes the active framework', () => {
        const registries = setup()
        registries.features.register({
            id: 'test:orch-other-fw',
            version: '0.1.0',
            label: 'other-fw',
            stage: STAGE.STYLING,
            frameworks: ['some-other-framework'],
            async execute() {},
        }, origin)

        const ctx = fakeCtx(registries, ['test:orch-other-fw'])
        const ordered = resolveExecutionOrder(ctx).map((f) => f.id)
        expect(ordered).not.toContain('test:orch-other-fw')
    })
})
