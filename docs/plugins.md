# Plugins

battlestack is a small plugin system rather than a monolith. Everything you use
arrives through the same public plugin API that a third party would use: the
three Nuxt templates and all 39 features are registered by
`@battlestack/preset-nuxt4`, which has no privileged access to the CLI.

That is the load-bearing claim of the design. If the built-in preset needed
private hooks, a plugin you wrote would always be a second-class citizen.

## Two things called "module"

Worth separating before going further, because both appear in a generated
project:

- A **Nuxt module** is a Nuxt-ecosystem package like `@pinia/nuxt`. Features
  install these into the generated app through `collectModules`. They are part
  of the *output*.
- A **battlestack plugin** extends the *CLI*: it adds features, templates,
  commands or deploy targets. It is not a dependency of your app.

This page is about the second kind.

## What a plugin can contribute

A plugin's `register` function receives a context with six methods, and that is
the entire surface:

| Method | Contributes |
| --- | --- |
| `addFeature(feature)` | A versioned unit of work: files, dependencies, env vars, docs, commands. |
| `addTemplate(template)` | A new starting point, assembled from any registered features. |
| `extendTemplate(extension)` | Extra features injected into a template somebody else defined. |
| `addFramework(framework)` | A whole new framework, with the feature ids it supports. |
| `addCommand(command)` | A new `battlestack <id>` subcommand. |
| `addDeployTarget(target)` | A deploy destination selectable at scaffold time. |

## The smallest useful plugin

```ts
import { defineBattlestackPlugin } from '@battlestack/core'
import { myFeature } from './features/my-feature.js'

export default defineBattlestackPlugin({
    name: 'battlestack-plugin-acme',
    apiVersion: 1,
    namespace: 'acme',
    register(battlestack) {
        battlestack.addFeature(myFeature)
        battlestack.extendTemplate({
            templateId: 'nuxt4-fullstack',
            addOptionalFeatures: ['acme:analytics'],
        })
    },
})
```

Four things are required: the package name, `apiVersion: 1`, a `register`
function, and a default export. `namespace` is optional and defaults to the
package scope (or the bare name, if unscoped).

`apiVersion` is checked on load. A plugin targeting a version the CLI does not
provide is rejected with a clear message rather than half-loaded.

## Naming, which is also the discovery gate

**A plugin package must be named `battlestack-plugin*` or
`battlestack-preset*`, optionally scoped.** These all qualify:

```
battlestack-plugin-acme
battlestack-preset-svelte
@acme/battlestack-plugin
@acme/battlestack-plugin-analytics
```

This is not a convention, it is enforced. A package in the plugin store whose
name does not match is skipped with a warning explaining that it will never
load, because silently ignoring it would be worse.

## Installing a plugin

Plugins are installed per machine, into a store at `~/.battlestack/plugins`,
rather than into your project:

```bash
battlestack plugin add battlestack-plugin-acme
battlestack plugin list
battlestack plugin remove battlestack-plugin-acme
```

The store is a small npm project owned by the CLI, and it installs using your
existing npm authentication. A plugin published to a private registry therefore
works with no extra configuration on battlestack's side: whatever your npm
client can already read, the store can install.

For local development, point it at a checkout and it links by path:

```bash
battlestack plugin add ../my-plugin
```

Because the store is per machine and not per project, adding a plugin does not
add a dependency to the app you ship.

## Where plugins are loaded from

Four sources, in this precedence order. The first occurrence of a package name
wins, so a later source cannot override an earlier one:

| Source | How | Failure to load |
| --- | --- | --- |
| **env** | `BATTLESTACK_PLUGINS=<comma-separated specifiers>` | Fatal |
| **project** | A `plugins` array in the project's `battlestack.config.json` | Fatal |
| **store** | Installed with `battlestack plugin add` | Warns, continues |
| **bundled** | Ships with the CLI (the Nuxt preset) | Fatal |

The store tolerating a load failure is deliberate: one broken machine-level
plugin should not stop you scaffolding. A plugin your *project* declares is a
stated requirement of that project, so it is fatal.

`battlestack plugins` lists what actually loaded and where each came from. It is
the first thing to check when a plugin's features are not showing up.

## Writing a feature

A feature is a plain object. Only `id`, `label`, `stage`, `version` and
`execute` are required; everything else is opt-in.

```ts
import { STAGE, type Feature } from '@battlestack/core'

export const analyticsFeature: Feature = {
    id: 'acme:analytics',
    version: '1.0.0',
    label: 'Analytics',
    description: 'Page-view tracking, opt-in by consent.',
    frameworks: ['nuxt4'],
    stage: STAGE.BASE_CONFIG,
    requires: ['nuxt4:nuxt-ui'],

    collectDeps() {
        return { prod: ['@acme/analytics'] }
    },

    collectEnv() {
        return [{ key: 'ANALYTICS_KEY', value: '', comment: 'from the Acme dashboard' }]
    },

    async execute(ctx) {
        // write files into ctx.projectDir
    },

    async update(ctx, prev) {
        // re-apply for an existing project, idempotently
    },
}
```

### The contribution hooks

Some hooks emit; most only *collect*, and something else owns the write. This
matters, because a feature that writes an aggregated file directly will fight
the feature that owns it.

| Hook | Aggregated by | Purpose |
| --- | --- | --- |
| `collectDeps` | the install feature | npm dependencies, prod and dev. |
| `collectModules` | the scaffold feature | Nuxt module identifiers. |
| `collectEnv` | the env feature | `.env` entries. Features must never write env files themselves. |
| `collectDocs` | the docs feature | Sections merged into `README.md` and `AGENTS.md`. |
| `collectSkills` | the install feature | AI-agent skills to install. |
| `collectBuildSecrets` | the docker feature | Docker BuildKit build-time secrets. |
| `projectCommands` | the CLI | `battlestack <name>` commands, live only while the feature is enabled. |

### Lifecycle hooks

| Hook | When it runs |
| --- | --- |
| `prompt` | At scaffold, for feature-specific follow-up questions. It **must** bypass itself under `--yes`, or non-interactive runs hang. |
| `execute` | The initial install, during scaffold. |
| `update` | `battlestack pull` against an existing project. Must be idempotent. |
| `preCheck` | Before every project-mode command. For idempotent maintenance. |
| `structuralFiles` | Declares paths that belong to the user from the start, so `pull` never touches them. |

### Ordering

Ordering is coarse-then-fine. Every feature declares a **stage**, and stages run
in a fixed order:

```
SCAFFOLD → GITIGNORE → NAMING → BASE_CONFIG → STYLING → I18N →
DATABASE → AUTH → AUTH_EXTRAS → STORAGE → AI_CORE → CHAT → RAG →
MASTRA → PWA → ICONS → AI_TOOL_CONFIG → DOCS → ENV → FINALIZE
```

Within a stage, `before` and `after` give fine ordering. Stage order wins on
conflict, so you cannot use `after` to escape your stage.

`requires` is a different thing from ordering: it lists features that must be
*enabled*, and enabling yours pulls them in.

### Failure behaviour

`failureIsNonFatal: true` downgrades a failure in your feature to a warning
instead of aborting the whole run. It is right for genuinely additive features
(analytics, a PWA manifest) and wrong for anything later features depend on.

## Versioning a feature, and why it is not optional

**A feature's `version` is how `battlestack pull` knows there is anything to
do.** A project's manifest records the version that produced each file. When
`pull` sees an unchanged version, it reports the feature up to date and never
calls `update`.

So: **change what your feature emits, bump its version.** Skip the bump and
existing projects will never see the change, while new scaffolds will, which is
the most confusing possible outcome.

One sharp edge. `collectDocs` and `collectEnv` do not write anything themselves;
they are aggregated and written by the feature that owns the target file. `pull`
version-gates on the *writing* feature. Changing your `collectDocs` output and
bumping only your own version reaches new scaffolds and no existing project.

A feature's version is unrelated to any package release number. It is a content
marker, not a release.

## Extending somebody else's template

`extendTemplate` injects features into a template another plugin defined, and it
is applied after every plugin has loaded, so it does not depend on load order:

```ts
battlestack.extendTemplate({
    templateId: 'nuxt4-fullstack',
    addFeatures: ['acme:observability'],          // always on
    addOptionalFeatures: ['acme:analytics'],      // a user-selectable checkbox
})
```

`addFeatures` forces a feature on for everybody using that template.
`addOptionalFeatures` keeps it a choice. Reach for the second unless the
template is genuinely broken without your feature.

An unknown `templateId` warns and is skipped rather than failing the run, so a
plugin written against a template that later disappears degrades instead of
breaking the CLI.

This is the mechanism that lets a private plugin extend a public install
**without the public code referencing it**. The public preset defines
`nuxt4-fullstack` and knows nothing about your additions; users without your
plugin get the template unchanged.

## Adding a command

```ts
battlestack.addCommand({
    id: 'deploy',
    usage: 'deploy [env]',
    description: 'Ship it',
    run({ args, registries }) {
        // ...
    },
})
```

Plugin commands appear in `battlestack --help` grouped under the plugin that
owns them, and only when that plugin is installed. Built-in names take
precedence, so a plugin cannot shadow `battlestack dev`.

## Ids: what you write and what gets registered

You author `acme:analytics`. Registration prefixes your namespace, producing a
fully-qualified id. Users type the short form, and it resolves as long as it is
unambiguous; if two plugins register the same short id, the CLI asks you to
qualify it rather than guessing.

The distinction matters when you write code that compares ids, and getting it
subtly wrong is easy. [architecture.md](architecture.md) section 2 covers it
properly, and reading it before writing id-handling logic will save you time.

## Testing a plugin

Build registries through the real loader path rather than hand-assembling them.
Hand-built registry objects leave short ids equal to fully-qualified ids, a shape
production never produces, which makes any code that confuses the two invisible
to your tests. [CONTRIBUTING.md](../CONTRIBUTING.md) has the reasoning and the
helpers.

While iterating, link your checkout and load it explicitly:

```bash
battlestack plugin add ../my-plugin
battlestack plugins                  # confirm it loaded, and from where
BATTLESTACK_PLUGINS=../my-plugin battlestack my-app --dry-run
```

`--dry-run` prints the plan and writes nothing, which makes it the fastest way to
check your feature landed in the right stage.

## Compatibility

`apiVersion` is the contract. The CLI checks it on load and refuses a plugin
built for a different major, with a message naming both versions, rather than
failing later in a way that looks like your bug.

[architecture.md](architecture.md) covers the compatibility gate, plugin
discovery and the injectable seams in full detail.
