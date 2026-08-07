import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { Registry, BattlestackRegistries } from '../src/registry.js'
import type { Feature, Provenance } from '../src/types.js'

const battlestackOrigin: Provenance = { plugin: '@battlestack/preset-nuxt', namespace: 'battlestack' }
const acmeOrigin: Provenance = { plugin: '@acme/battlestack-plugin', namespace: 'acme' }

function feature(id: string): Feature {
    return { id, label: id, stage: 'FINALIZE', version: '1.0.0', execute: async () => {} }
}

describe('Registry id resolution', () => {
    it('resolves a bare id when exactly one plugin registered it', () => {
        const reg = new Registry<Feature>('Feature', 2)
        reg.register(feature('shared:docker'), battlestackOrigin)
        assert.equal(reg.get('shared:docker').fqid, 'battlestack:shared:docker')
    })

    it('always resolves a fully-qualified id', () => {
        const reg = new Registry<Feature>('Feature', 2)
        reg.register(feature('shared:deploy'), battlestackOrigin)
        reg.register(feature('shared:deploy'), acmeOrigin)
        assert.equal(reg.get('battlestack:shared:deploy').origin.plugin, '@battlestack/preset-nuxt')
        assert.equal(reg.get('acme:shared:deploy').origin.plugin, '@acme/battlestack-plugin')
    })

    it('throws on an ambiguous bare id, listing qualified candidates', () => {
        const reg = new Registry<Feature>('Feature', 2)
        reg.register(feature('shared:deploy'), battlestackOrigin)
        reg.register(feature('shared:deploy'), acmeOrigin)
        assert.throws(() => reg.get('shared:deploy'), /battlestack:shared:deploy.*acme:shared:deploy/)
    })

    it('throws on an unknown id', () => {
        const reg = new Registry<Feature>('Feature', 2)
        assert.throws(() => reg.get('shared:nope'), /Unknown feature/)
    })

    it('names both plugins on a fqid clash', () => {
        const reg = new Registry<Feature>('Feature', 2)
        reg.register(feature('shared:deploy'), acmeOrigin)
        const clashing: Provenance = { plugin: '@acme/other-plugin', namespace: 'acme' }
        assert.throws(
            () => reg.register(feature('shared:deploy'), clashing),
            /@acme\/battlestack-plugin.*@acme\/other-plugin/,
        )
    })
})

describe('Registry invariants', () => {
    it('rejects an authored id with the wrong segment count', () => {
        const features = new Registry<Feature>('Feature', 2)
        assert.throws(() => features.register(feature('docker'), battlestackOrigin), /expected "<domain>:<name>"/)
        // 3 segments would collide with the fqid shape: the shadowing guard.
        assert.throws(() => features.register(feature('battlestack:shared:docker'), acmeOrigin), /Invalid feature id/)
        const templates = new Registry<{ id: string }>('Template', 1)
        assert.throws(() => templates.register({ id: 'a:b' }, battlestackOrigin), /plain slug/)
    })

    it('does not alias the caller-owned object', () => {
        const reg = new Registry<Feature & { tags: string[] }>('Feature', 2)
        const original = { ...feature('shared:docker'), tags: ['x'] }
        reg.register(original, battlestackOrigin)
        const stored = reg.get('shared:docker')
        assert.notEqual(stored, original)
        assert.equal((original as { fqid?: string }).fqid, undefined)
    })

    it('rejects register() after seal()', () => {
        const registries = new BattlestackRegistries()
        registries.features.register(feature('shared:docker'), battlestackOrigin)
        registries.seal()
        assert.throws(() => registries.features.register(feature('nuxt4:auth'), battlestackOrigin), /sealed/)
    })
})
