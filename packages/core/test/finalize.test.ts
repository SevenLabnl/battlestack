import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { applyPlugin, defineBattlestackPlugin, finalizeRegistries, type LoadedPlugin } from '../src/plugin.js'
import { BattlestackRegistries } from '../src/registry.js'
import type { Feature, Template } from '../src/types.js'

function feature(id: string): Feature {
    return { id, label: id, stage: 'FINALIZE', version: '1.0.0', execute: async () => {} }
}

/** Load a public preset + internal plugin the way the loader does, then finalize. */
function load(publicTemplate: Template) {
    const registries = new BattlestackRegistries()
    const loaded: LoadedPlugin[] = []

    loaded.push(applyPlugin(defineBattlestackPlugin({
        name: '@battlestack/preset-nuxt',
        apiVersion: 1,
        register(battlestack) {
            battlestack.addFeature(feature('shared:docker'))
            battlestack.addFeature(feature('nuxt4:auth'))
            battlestack.addTemplate(publicTemplate)
        },
    }), 'bundled', registries))

    loaded.push(applyPlugin(defineBattlestackPlugin({
        name: '@acme/battlestack-plugin',
        apiVersion: 1,
        register(battlestack) {
            battlestack.addFeature(feature('shared:deploy'))
            battlestack.extendTemplate({ templateId: 'fullstack', addFeatures: ['shared:deploy'] })
            battlestack.extendTemplate({ templateId: 'ghost', addFeatures: ['shared:deploy'] })
            battlestack.extendTemplate({ templateId: 'fullstack', addFeatures: ['shared:typo'] })
            battlestack.addCommand({ id: 'deploy', description: 'Deploy', run() {} })
        },
    }), 'store', registries))

    const warnings = finalizeRegistries(registries, loaded.flatMap((p) => p.extensions))
    return { registries, warnings }
}

function fullstack(): Template {
    return {
        id: 'fullstack',
        label: 'Full-stack',
        framework: 'nuxt',
        requiredFeatures: ['nuxt4:auth'],
        optionalFeatures: ['shared:docker'],
    }
}

describe('finalizeRegistries', () => {
    it('canonicalizes template feature lists to fqids and applies extensions as required features', () => {
        const { registries } = load(fullstack())
        const t = registries.templates.get('fullstack')
        assert.deepEqual(t.requiredFeatures, ['battlestack:nuxt4:auth', 'acme:shared:deploy'])
        assert.deepEqual(t.optionalFeatures, ['battlestack:shared:docker'])
    })

    it('never mutates the plugin module\'s template object', () => {
        const original = fullstack()
        load(original)
        assert.deepEqual(original.requiredFeatures, ['nuxt4:auth'])
        assert.deepEqual(original.optionalFeatures, ['shared:docker'])
    })

    it('warns on unknown templates and unregistered features instead of throwing', () => {
        const { warnings } = load(fullstack())
        assert.equal(warnings.length, 2)
        assert.match(warnings.find((w) => w.includes('ghost'))!, /skipped/)
        assert.match(warnings.find((w) => w.includes('shared:typo'))!, /dropped/)
    })

    it('drops an ambiguous bare id from a template with a warning', () => {
        const registries = new BattlestackRegistries()
        const loaded = [
            applyPlugin(defineBattlestackPlugin({
                name: '@battlestack/preset-nuxt',
                apiVersion: 1,
                register(battlestack) {
                    battlestack.addFeature(feature('shared:deploy'))
                    battlestack.addTemplate({
                        id: 't', label: 't', framework: 'nuxt', requiredFeatures: ['shared:deploy'], optionalFeatures: [],
                    })
                },
            }), 'bundled', registries),
            applyPlugin(defineBattlestackPlugin({
                name: '@acme/battlestack-plugin',
                apiVersion: 1,
                register(battlestack) {
                    battlestack.addFeature(feature('shared:deploy'))
                },
            }), 'store', registries),
        ]
        const warnings = finalizeRegistries(registries, loaded.flatMap((p) => p.extensions))
        assert.deepEqual(registries.templates.get('t').requiredFeatures, [])
        assert.match(warnings[0], /Ambiguous/)
    })

    it('dedupes bare and qualified spellings of the same feature', () => {
        const template = fullstack()
        template.requiredFeatures = ['nuxt4:auth', 'battlestack:nuxt4:auth']
        const { registries } = load(template)
        assert.deepEqual(
            registries.templates.get('fullstack').requiredFeatures,
            ['battlestack:nuxt4:auth', 'acme:shared:deploy'],
        )
    })

    it('applies addOptionalFeatures as user-selectable, not required', () => {
        const registries = new BattlestackRegistries()
        const loaded: LoadedPlugin[] = []
        loaded.push(applyPlugin(defineBattlestackPlugin({
            name: '@battlestack/preset-nuxt',
            apiVersion: 1,
            register(battlestack) {
                battlestack.addFeature(feature('nuxt4:auth'))
                battlestack.addFeature(feature('shared:docker'))
                battlestack.addTemplate(fullstack())
            },
        }), 'bundled', registries))
        loaded.push(applyPlugin(defineBattlestackPlugin({
            name: '@acme/battlestack-plugin',
            apiVersion: 1,
            register(battlestack) {
                battlestack.addFeature(feature('nuxt4:fontawesome'))
                battlestack.extendTemplate({
                    templateId: 'fullstack',
                    addOptionalFeatures: ['nuxt4:fontawesome'],
                })
            },
        }), 'store', registries))

        const warnings = finalizeRegistries(registries, loaded.flatMap((p) => p.extensions))
        const t = registries.templates.get('fullstack')
        assert.deepEqual(warnings, [])
        assert.deepEqual(t.optionalFeatures, ['battlestack:shared:docker', 'acme:nuxt4:fontawesome'])
        assert.ok(!t.requiredFeatures.includes('acme:nuxt4:fontawesome'))
    })

    it('dedupes an id that would otherwise land in both requiredFeatures and optionalFeatures', () => {
        const registries = new BattlestackRegistries()
        const loaded: LoadedPlugin[] = []
        loaded.push(applyPlugin(defineBattlestackPlugin({
            name: '@battlestack/preset-nuxt',
            apiVersion: 1,
            register(battlestack) {
                battlestack.addFeature(feature('nuxt4:auth'))
                battlestack.addFeature(feature('shared:docker'))
                battlestack.addTemplate(fullstack())
            },
        }), 'bundled', registries))
        loaded.push(applyPlugin(defineBattlestackPlugin({
            name: '@acme/battlestack-plugin',
            apiVersion: 1,
            register(battlestack) {
                battlestack.addFeature(feature('shared:deploy'))
                // Same id via BOTH channels: required must win, and it must not also
                // appear in optionalFeatures.
                battlestack.extendTemplate({ templateId: 'fullstack', addFeatures: ['shared:deploy'] })
                battlestack.extendTemplate({ templateId: 'fullstack', addOptionalFeatures: ['shared:deploy'] })
            },
        }), 'store', registries))

        finalizeRegistries(registries, loaded.flatMap((p) => p.extensions))
        const t = registries.templates.get('fullstack')
        assert.deepEqual(t.requiredFeatures, ['battlestack:nuxt4:auth', 'acme:shared:deploy'])
        assert.ok(!t.optionalFeatures.includes('acme:shared:deploy'))
    })

    it('registers plugin commands namespaced with provenance', () => {
        const { registries } = load(fullstack())
        const cmd = registries.commands.get('deploy')
        assert.equal(cmd.fqid, 'acme:deploy')
        assert.equal(cmd.origin.plugin, '@acme/battlestack-plugin')
    })

    it('canonicalizes defaultEnabledOptional to fqids, same as optionalFeatures', () => {
        const registries = new BattlestackRegistries()
        applyPlugin(defineBattlestackPlugin({
            name: '@battlestack/preset-nuxt',
            apiVersion: 1,
            register(battlestack) {
                battlestack.addFeature(feature('nuxt4:auth'))
                battlestack.addFeature(feature('shared:docker'))
                battlestack.addTemplate({
                    id: 'fullstack-defaults',
                    label: 'Full-stack',
                    framework: 'nuxt',
                    requiredFeatures: ['nuxt4:auth'],
                    optionalFeatures: ['shared:docker'],
                    defaultEnabledOptional: ['shared:docker'],
                })
            },
        }), 'bundled', registries)

        const warnings = finalizeRegistries(registries, [])
        const t = registries.templates.get('fullstack-defaults')
        assert.deepEqual(warnings, [])
        assert.deepEqual(t.optionalFeatures, ['battlestack:shared:docker'])
        // defaultEnabledOptional must land in the SAME fqid form as optionalFeatures, or
        // a downstream `includes(id)` check never matches and nothing is selected.
        assert.deepEqual(t.defaultEnabledOptional, ['battlestack:shared:docker'])
        assert.ok(t.optionalFeatures.includes(t.defaultEnabledOptional![0]!))
    })

    it('silently drops an unresolvable defaultEnabledOptional entry: no separate warning', () => {
        const registries = new BattlestackRegistries()
        applyPlugin(defineBattlestackPlugin({
            name: '@battlestack/preset-nuxt',
            apiVersion: 1,
            register(battlestack) {
                battlestack.addFeature(feature('shared:docker'))
                battlestack.addTemplate({
                    id: 'defaults-typo',
                    label: 'Defaults typo',
                    framework: 'nuxt',
                    requiredFeatures: [],
                    optionalFeatures: ['shared:docker'],
                    defaultEnabledOptional: ['shared:nope'],
                })
            },
        }), 'bundled', registries)

        const warnings = finalizeRegistries(registries, [])
        const t = registries.templates.get('defaults-typo')
        assert.deepEqual(t.defaultEnabledOptional, [])
        // No warning here: in the normal shape `shared:nope` is also in
        // `optionalFeatures`, which already warned. Warning twice is noise.
        assert.deepEqual(warnings, [])
    })

    it('warns distinctly when a resolvable defaultEnabledOptional id is not actually in optionalFeatures (template-authoring bug)', () => {
        const registries = new BattlestackRegistries()
        applyPlugin(defineBattlestackPlugin({
            name: '@battlestack/preset-nuxt',
            apiVersion: 1,
            register(battlestack) {
                battlestack.addFeature(feature('shared:docker'))
                // Registered, but never listed as optional below. Authoring it in
                // `defaultEnabledOptional` anyway is a distinct template bug.
                battlestack.addFeature(feature('shared:security'))
                battlestack.addTemplate({
                    id: 'defaults-not-optional',
                    label: 'Defaults not optional',
                    framework: 'nuxt',
                    requiredFeatures: [],
                    optionalFeatures: ['shared:docker'],
                    defaultEnabledOptional: ['shared:security'],
                })
            },
        }), 'bundled', registries)

        const warnings = finalizeRegistries(registries, [])
        const t = registries.templates.get('defaults-not-optional')
        assert.deepEqual(t.defaultEnabledOptional, [])
        assert.equal(warnings.length, 1)
        assert.match(warnings[0]!, /shared:security/)
        assert.match(warnings[0]!, /optionalFeatures/)
    })

    // `Framework.supportedFeatures` is the sole input to `add`'s framework check,
    // compared against the same string as the template's fqid lists, so bare broke both.
    it('canonicalizes Framework.supportedFeatures to fqids', () => {
        const registries = new BattlestackRegistries()
        applyPlugin(defineBattlestackPlugin({
            name: '@battlestack/preset-nuxt',
            apiVersion: 1,
            register(battlestack) {
                battlestack.addFeature(feature('nuxt4:auth'))
                battlestack.addFeature(feature('shared:docker'))
                battlestack.addFramework({
                    id: 'nuxt',
                    label: 'Nuxt',
                    supportedFeatures: ['nuxt4:auth', 'shared:docker'],
                })
                battlestack.addTemplate({
                    id: 'supported-fqid',
                    label: 'Supported fqid',
                    framework: 'nuxt',
                    requiredFeatures: ['nuxt4:auth'],
                    optionalFeatures: ['shared:docker'],
                })
            },
        }), 'bundled', registries)

        const warnings = finalizeRegistries(registries, [])
        const fw = registries.frameworks.get('nuxt')
        assert.deepEqual(warnings, [])
        assert.deepEqual(fw.supportedFeatures, ['battlestack:nuxt4:auth', 'battlestack:shared:docker'])
        // The invariant that matters downstream: an id in a template's optional list must
        // be findable in the framework catalog using ONE spelling, as `add` compares it.
        const t = registries.templates.get('supported-fqid')
        for (const id of [...t.requiredFeatures, ...t.optionalFeatures]) {
            assert.ok(fw.supportedFeatures.includes(id), `${id} missing from supportedFeatures`)
        }
    })

    it('keeps an advertised-but-unregistered supportedFeatures id verbatim, without warning', () => {
        const registries = new BattlestackRegistries()
        applyPlugin(defineBattlestackPlugin({
            name: '@battlestack/preset-nuxt',
            apiVersion: 1,
            register(battlestack) {
                battlestack.addFeature(feature('shared:docker'))
                battlestack.addFramework({
                    id: 'nuxt',
                    label: 'Nuxt',
                    // Advertised by the preset, registered only by a private plugin.
                    // A catalog entry with nothing behind it is a supported state.
                    supportedFeatures: ['shared:docker', 'nuxt4:fontawesome'],
                })
            },
        }), 'bundled', registries)

        const warnings = finalizeRegistries(registries, [])
        assert.deepEqual(warnings, [])
        assert.deepEqual(
            registries.frameworks.get('nuxt').supportedFeatures,
            ['battlestack:shared:docker', 'nuxt4:fontawesome'],
        )
    })

    it('warns when a supportedFeatures id is ambiguous, leaving it unqualified', () => {
        const registries = new BattlestackRegistries()
        // Two plugins register the same bare id, so it names no one feature. Unlike the
        // unregistered case this IS actionable, and keeping it bare matches neither fqid.
        for (const name of ['@battlestack/preset-nuxt', '@acme/battlestack-plugin']) {
            applyPlugin(defineBattlestackPlugin({
                name,
                apiVersion: 1,
                register(battlestack) {
                    battlestack.addFeature(feature('shared:docker'))
                    if (name.startsWith('@battlestack')) {
                        battlestack.addFramework({
                            id: 'nuxt',
                            label: 'Nuxt',
                            supportedFeatures: ['shared:docker'],
                        })
                    }
                },
            }), 'bundled', registries)
        }

        const warnings = finalizeRegistries(registries, [])
        assert.deepEqual(registries.frameworks.get('nuxt').supportedFeatures, ['shared:docker'])
        assert.equal(warnings.length, 1)
        assert.match(warnings[0]!, /shared:docker/)
        assert.match(warnings[0]!, /ambiguous/i)
    })

    it('rejects an invalid plugin namespace', () => {
        const registries = new BattlestackRegistries()
        assert.throws(
            () => applyPlugin(defineBattlestackPlugin({
                name: 'bad',
                apiVersion: 1,
                namespace: 'no:colons',
                register() {},
            }), 'env', registries),
            /invalid namespace/,
        )
    })
})
