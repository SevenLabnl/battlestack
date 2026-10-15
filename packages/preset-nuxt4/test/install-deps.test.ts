import { describe, expect, it } from 'vitest'
import { keepsHigherFloor, reconcileDependencyBuckets } from '../src/features/install.js'

it('keeps an existing pin when a bare dependency moves buckets', () => {
    const pkg: Record<string, unknown> = { dependencies: { typescript: '^5.9.0' }, devDependencies: {} }
    reconcileDependencyBuckets(pkg, {}, { typescript: 'latest' })
    expect(pkg).toEqual({ dependencies: {}, devDependencies: { typescript: '^5.9.0' } })
})

it('lets a feature range replace a peer pin written into the other bucket', () => {
    // `nuxi module add` writes required peers such as typescript into `dependencies`.
    const pkg: Record<string, unknown> = { dependencies: { typescript: '^7.0.2' }, devDependencies: {} }
    reconcileDependencyBuckets(pkg, {}, { typescript: '^6' })
    expect(pkg).toEqual({ dependencies: {}, devDependencies: { typescript: '^6' } })
})

describe('keepsHigherFloor', () => {
    it('keeps a project range with a higher floor in the same major', () => {
        expect(keepsHigherFloor('^4.4.3', '^4')).toBe(true)
        expect(keepsHigherFloor('^11.0.0', '^11')).toBe(true)
        expect(keepsHigherFloor('npm:@ai-sdk/provider-utils@^3.0.32', 'npm:@ai-sdk/provider-utils@^3')).toBe(true)
    })

    it('lets the feature raise the floor or change the major', () => {
        expect(keepsHigherFloor('^4.4.3', '^4.5.0')).toBe(false)
        expect(keepsHigherFloor('^4.9.0', '^5')).toBe(false)
        expect(keepsHigherFloor('~4.4.3', '^4')).toBe(false)
        expect(keepsHigherFloor('npm:other@^3.1.0', 'npm:@ai-sdk/provider-utils@^3')).toBe(false)
    })
})
