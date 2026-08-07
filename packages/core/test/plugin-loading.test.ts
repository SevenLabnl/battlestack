import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'vitest'
import { loadPlugins, type PluginSource } from '../src/loader.js'

/**
 * Exercises the real `loadPlugins` pipeline end to end, including the dynamic `import()`,
 * not just `applyPlugin`. The fixtures mirror the real preset and internal plugin.
 */
const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')

const publicPlugin: PluginSource = {
    specifier: path.join(fixturesDir, 'public-plugin'),
    via: 'bundled',
    required: true,
}
const internalPlugin: PluginSource = {
    specifier: path.join(fixturesDir, 'internal-plugin'),
    via: 'store',
    required: false,
}
const brokenPlugin: PluginSource = {
    specifier: path.join(fixturesDir, 'broken-plugin'),
    via: 'store',
    required: false,
}

describe('loadPlugins: public-only vs public+internal registration', () => {
    it('public-only: registers just the public surface, no internal feature/command/deploy target', async () => {
        const result = await loadPlugins([publicPlugin])

        assert.equal(result.plugins.length, 1)
        assert.equal(result.skipped.length, 0)
        assert.equal(result.warnings.length, 0)

        assert.equal(result.registries.features.has('shared:deploy'), false)
        assert.equal(result.registries.features.get('nuxt4:auth').fqid, 'battlestack:nuxt4:auth')

        // The internal plugin's extendTemplate never ran, so the public template keeps
        // only what the preset itself required.
        const template = result.registries.templates.get('nuxt4-fullstack')
        assert.deepEqual(template.requiredFeatures, ['battlestack:nuxt4:auth'])

        assert.throws(() => result.registries.commands.get('deploy'), /Unknown command/)
        assert.throws(() => result.registries.deployTargets.get('acme'), /Unknown deploytarget/)
    })

    it('public+internal: internal plugin extends the public template and adds its own feature/command/target', async () => {
        const result = await loadPlugins([publicPlugin, internalPlugin])

        assert.equal(result.plugins.length, 2)
        assert.equal(result.skipped.length, 0)
        assert.equal(result.warnings.length, 0, `unexpected warnings: ${result.warnings.join('; ')}`)

        assert.equal(result.registries.features.get('shared:deploy').fqid, 'acme:shared:deploy')

        // extendTemplate is load-order-independent and always REQUIRED, so the internal
        // plugin bolts its feature on regardless of load order.
        const template = result.registries.templates.get('nuxt4-fullstack')
        assert.deepEqual(template.requiredFeatures, ['battlestack:nuxt4:auth', 'acme:shared:deploy'])
        // Never mutates what the public preset itself required.
        assert.deepEqual(template.optionalFeatures, ['battlestack:shared:docker'])

        assert.equal(result.registries.commands.get('deploy').fqid, 'acme:deploy')
        assert.equal(result.registries.deployTargets.get('acme').fqid, 'acme:acme')
        // Public deploy target from the other plugin is unaffected.
        assert.equal(result.registries.deployTargets.get('docker').fqid, 'battlestack:docker')
    })

    it('loading the internal plugin alone never happens in practice, but does not implicitly need the public one', async () => {
        // The internal plugin's own feature registers fine standalone; only its
        // *extension* target is unresolvable without the public template.
        const result = await loadPlugins([internalPlugin])
        assert.equal(result.registries.features.get('shared:deploy').fqid, 'acme:shared:deploy')
        assert.equal(result.warnings.length, 1)
        assert.match(result.warnings[0], /nuxt4-fullstack/)
    })

    it('a broken discovered (non-required, "via: store") plugin is skipped, not thrown', async () => {
        const result = await loadPlugins([publicPlugin, brokenPlugin])
        assert.equal(result.plugins.length, 1)
        assert.equal(result.skipped.length, 1)
        assert.equal(result.skipped[0].specifier, brokenPlugin.specifier)
        assert.equal(result.skipped[0].via, 'store')
        assert.match(result.skipped[0].error, /not a battlestack plugin/)
    })

    it('a broken required plugin throws instead of loading silently broken', async () => {
        await assert.rejects(
            loadPlugins([{ ...brokenPlugin, required: true }]),
            /not a battlestack plugin/,
        )
    })
})
