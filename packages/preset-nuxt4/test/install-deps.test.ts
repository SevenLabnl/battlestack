import { expect, it } from 'vitest'
import { reconcileDependencyBuckets } from '../src/features/install.js'

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
