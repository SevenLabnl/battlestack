# Architecture

This is a plugin-based CLI for scaffolding projects. `battlestack` (the CLI)
loads *plugins* — npm packages that register **features**, **frameworks**,
**templates**, **commands**, and **deploy targets** into shared registries.
The CLI itself doesn't know what a "Nuxt project" or a "database feature" is;
it only knows how to load plugins and run whatever they registered.

This document describes what the code actually does. Where something is a
known rough edge rather than a deliberate design, it says so.

## 1. The four packages

```
packages/
├── core/            @battlestack/core        plugin SDK: types, registries, loader, orchestrator
├── tui/              @battlestack/tui         terminal UI: banner, spinner, colors, prompts
├── preset-nuxt4/     @battlestack/preset-nuxt4  the Nuxt 4 framework preset (a plugin)
└── cli/              battlestack               the `battlestack` binary
```

**`core` is a dependency-light spine.** It exports every type a plugin author
needs (`Feature`, `Framework`, `Template`, `RunContext`, `DeployTarget`,
`defineBattlestackPlugin`), the registries, the plugin loader, and the
feature orchestrator. It has no dependency on the CLI or on any preset —
that direction would be backwards, since the CLI *loads* presets as plugins
at runtime. `core`'s only runtime dependencies are generic (`diff`,
`magicast`, `ora`); nothing preset- or CLI-specific leaks in. Two injectable
seams exist specifically to keep it that way — see §6.

**`tui` exists to break a preset → cli dependency cycle.** A preset's project
commands legitimately want to print banners, run spinners, and prompt the
user — the same terminal UI the CLI itself uses for the top-level scaffold
flow. If that UI lived in the `cli` package, `preset-nuxt4` would have to
depend on `cli` to use it — but `cli` already depends on `preset-nuxt4`
(it bundles it, see §4). That's a cycle. Factoring the shared UI into its own
package with no dependency on either lets both `cli` and `preset-nuxt4`
depend on `tui` instead of on each other. `preset-nuxt4/src/features/database.ts`,
for example, imports `ui` from `@battlestack/tui` directly to print the refusal
message for its destructive `db:fresh` command (which has no prompt — it
hard-requires `--force`).

**`preset-nuxt4` is a plugin, not special-cased.** It registers the `nuxt4`
framework, 39 features, three templates, and the `create`/`init` commands,
using the exact same `BattlestackPluginContext` API any third-party plugin
would use (see §3). It is major-versioned — `preset-nuxt4`, not
`preset-nuxt` — specifically so a future `preset-nuxt5` can register
*alongside* it without id collisions: both would want the bare feature id
`database`, but their fully-qualified ids (§2) would be `nuxt4:nuxt4:database`
and `nuxt5:nuxt5:database` — distinct namespaces, both loadable in the same
process. The same version number is also what the manifest migration in
`core/src/manifest.ts` keys on: a project scaffolded before presets were
versioned has a bare `"nuxt"` framework id in its manifest, and adopting that
project pins it to `nuxt4` rather than guessing.

**`cli` is the thin binary.** Arg parsing, plugin discovery/loading (§4),
dispatch to whichever plugin registered the requested command, and the
project-mode command table for an already-scaffolded project. It hard-depends
on `@battlestack/preset-nuxt4` as a *bundled* plugin (see §4) so
`pnpm dlx battlestack` works with zero configuration, and soft-loads anything
else found by discovery.

## 2. Ids: authored, bare, and fully-qualified

A plugin author writes ids as `<domain>:<name>` — `nuxt4:database`,
`shared:github`. That's the **authored id**, and it's the only spelling a
plugin's own source code ever contains.

When a plugin registers something, the loader prefixes it with the plugin's
**namespace** (defaults to the npm scope, e.g. `@battlestack/preset-nuxt4` →
`battlestack`, or set explicitly via `defineBattlestackPlugin({ namespace })`
— `preset-nuxt4` pins `nuxt4` rather than deriving it) to produce the
**fully-qualified id (fqid)**: `nuxt4:nuxt4:database`. Yes, that's the
namespace and the domain both reading `nuxt4` for this particular preset —
coincidence of naming, not a bug; a third-party `@acme/battlestack-plugin`
registering `shared:deploy` gets `acme:shared:deploy`.

Lookups (`registries.features.get(id)`) accept either spelling:

- a **bare id resolves when exactly one loaded plugin registered it** — the
  common case, and the only spelling most feature code ever writes,
- a **fqid always resolves**, unambiguously,
- a bare id **two different plugins both registered** throws, listing the
  qualified candidates so the caller disambiguates.

Bare ids are input sugar only. Once every plugin has loaded, a finalize pass
(`finalizeRegistries` in `core/src/plugin.ts`) rewrites bare ids to fqids in
every field a per-entity role table (`TEMPLATE_ID_ROLES`,
`FRAMEWORK_ID_ROLES`) classifies as id-bearing — a template's
`requiredFeatures`, `optionalFeatures` and `defaultEnabledOptional`, a
framework's `supportedFeatures` catalog, and the feature lists of every
pending `extendTemplate` — then seals the registries. Two deliberate
exceptions: a template's `framework` field stays bare (it's matched against
`Registered<Framework>.id`, which is the authored id), and a feature's
`requires`/`after`/`before` edges are **not** canonicalized at all — see the
wart in §8.

In a persisted `.battlestack/manifest.json`, the per-feature records
(`features[].id`) and the `optedOut` list hold fqids, so installing a second
plugin later can never turn an already-saved feature reference ambiguous
retroactively. The `framework` and `template` fields are persisted bare
(`nuxt4`, `nuxt4-fullstack`), as are the keys of the per-feature file and
ownership state bags.

This is also why `enabledFeatures` inside a running feature is a
`Set<string>` of fqids, but a feature's own code checks membership with its
*authored* id (`'nuxt4:auth'`), not the fqid. A plain
`ctx.enabledFeatures.has('nuxt4:auth')` would miss — the set holds
`nuxt4:nuxt4:auth`. `isFeatureEnabled(ctx, 'nuxt4:auth')` (from
`@battlestack/core`) is the registry-aware check that resolves the authored
id through `ctx.registries` before testing membership, and is what feature
code is expected to call instead of touching the set directly.

## 3. The plugin API

A plugin is an npm package whose default export is built with
`defineBattlestackPlugin()`:

```ts
import { defineBattlestackPlugin } from '@battlestack/core'

export default defineBattlestackPlugin({
    name: '@acme/battlestack-plugin',
    apiVersion: 1,
    namespace: 'acme',   // optional — defaults to the npm scope
    register(battlestack) {
        battlestack.addFeature(deployFeature)               // id: 'shared:deploy'
        battlestack.addDeployTarget({ id: 'acme-cloud', label: 'Acme Cloud' })
        battlestack.extendTemplate({
            templateId: 'nuxt4-fullstack',
            addFeatures: ['shared:deploy'],
        })
        battlestack.addCommand({ id: 'deploy', description: 'Deploy to Acme Cloud', run: deployCommand })
    },
})
```

`register()` receives a scoped `BattlestackPluginContext`, not the raw
registries — every contribution gets tagged with its plugin of origin before
it reaches the registry, which is what puts the plugin's namespace in front of
every id it registers (§2) and what lets `battlestack plugins` account for
which package supplied what.

The methods on that context, as they exist today:

- **`addFeature`** — the main unit of work. See §5.
- **`addFramework`** — declares a framework: an id and label plus a
  `supportedFeatures` catalog (see the wart below). It carries no bootstrap
  code — bootstrapping is an ordinary feature (`nuxt4:scaffold`).
- **`addTemplate`** — defines a curated bundle: a framework id, a list of
  always-on `requiredFeatures`, and a list of user-selectable
  `optionalFeatures` (with an optional `defaultEnabledOptional` subset
  checked by default in the scaffold prompt).
- **`extendTemplate`** — lets *any* plugin bolt features onto a template
  *another* plugin defined, without editing that template. Takes
  `addFeatures` (always-on — appended to `requiredFeatures`, for a plugin
  that wants its feature forced on with no opt-out, e.g. a devops plugin
  wiring its own deploy pipeline into the public `fullstack` template) and
  `addOptionalFeatures` (the user-selectable counterpart — appended to
  `optionalFeatures`, for a plugin-contributed feature that should stay a
  checkbox). Both dedupe against *both* lists, so the same id can't land in
  each. Extensions apply in a second pass after every plugin has finished
  registering, so they're **load-order-independent**: it doesn't matter
  whether the plugin defining the template or the plugin extending it loads
  first. Extending a template no loaded plugin defined is skipped with a
  warning, not a crash — a public build with no plugins installed just
  never applies the extension.
- **`addCommand`** — a `battlestack <id>` subcommand, dispatched at the top
  level outside a project. Built-in CLI commands always win over a plugin
  command with the same id. Two gaps worth knowing: `battlestack help` doesn't
  list plugin commands (it renders built-ins and per-feature project commands
  only), and inside an already-scaffolded project plugin commands aren't
  dispatched at all — the project-mode table is built from `RESERVED_COMMANDS`
  plus each enabled feature's `projectCommands`.
- **`addDeployTarget`** — registers a `{ id, label, description? }` entry in
  the `deployTargets` registry. See §5's `shared:github` example for why
  this exists as an open registry rather than a closed union type.

A plugin ships its own template files by resolving them against its own
package — `templatesDir(import.meta.url, …)` from
`@battlestack/core/utils/templates.js`, which every `preset-nuxt4` feature
calls — so a plugin's copy-template code never reaches into another plugin's
files. Skills are contributed per-feature via `collectSkills` (§5), not at
plugin level.

An `extendTemplate` call that references *another* plugin's feature by id is
written as a bare id and canonicalized to a fqid at finalize time, same as a
template's own lists (§2) — so a plugin never has to know another plugin's
namespace up front. A feature's `requires`/`after`/`before` edges are the
exception: they are never canonicalized, and the orchestrator matches them
against each feature's bare authored id. Cross-plugin ordering edges
therefore can't be expressed safely today — see §8.

## 4. Plugin discovery

At CLI startup, `discoverPlugins()` assembles a list of plugin sources in
precedence order — **first occurrence of a given specifier string wins**
(dedupe is on the raw specifier, not the resolved package name, so a
`file:`-linked store entry and a name-based entry for the same package are
*not* deduped — both load, and the second registration throws):

1. **`BATTLESTACK_PLUGINS` env** — comma-separated package names or paths.
   Dev/CI override.
2. **Project-local** — the nearest `battlestack.config.json`'s `plugins`
   array, resolved from that project's own `node_modules`.
3. **User plugin store** — `~/.battlestack/plugins/`, a tiny npm project the
   CLI manages itself via `battlestack plugin add/remove/list`. Any
   dependency there matching `battlestack-plugin*` / `@*/battlestack-plugin*`
   (or the `-preset` variant) loads automatically.
4. **Bundled** — `@battlestack/preset-nuxt4`, resolved from the CLI's own
   dependencies. Always present.

Sources 1, 2 and 4 are **required**: a broken explicitly-configured plugin —
or a broken bundled preset — throws and aborts startup. Only
store-discovered plugins (3) are **best-effort**: `loadPlugins()` wraps each
dynamic `import()` in try/catch and skips a broken one with a warning
(reported by `battlestack plugins`) rather than bricking the CLI for every
other installed plugin.

This is the mechanism a private, unpublished plugin uses to extend a public
install without the public codebase referencing it by name anywhere: it's
just another entry in someone's plugin store.

## 5. Features, stages, and execution order

A `Feature` (`core/src/types/feature.ts`) is the unit of work a template
enables. Beyond `id`/`label`/`version`, its shape is a family of optional
`collect*` hooks the orchestrator or another feature aggregates across every
*enabled* feature, order-independently:

- `collectDeps` → npm dependencies to install
- `collectEnv` → `.env` entries, aggregated and written once by `shared:env`
- `collectDocs` → README/AGENTS.md sections
- `collectModules` → Nuxt module ids
- `collectSkills` → AI-agent skill sources to install. `shared:install`
  aggregates these across enabled features and shells out to the project's
  package manager (`<pm> dlx skills add <source>`) on scaffold and on every
  `pull`. Best-effort by design: a missing `skills` CLI or an unreachable
  registry warns and moves on, so "sources to install" is the honest reading,
  not "sources installed". Exactly one feature uses it today —
  `nuxt4:mastra`.
- `collectBuildSecrets` → Docker BuildKit build-time secrets, aggregated by
  `shared:docker` so any enabled feature can demand a secret at image-build
  time without `shared:docker` knowing about it ahead of time

and the lifecycle methods: `prompt` (interactive follow-up, must self-skip
under `ctx.state.nonInteractive`), `execute` (initial scaffold), `update`
(idempotent re-apply for `battlestack pull`), `projectCommands` (registers
into the project-mode command table).

**`stage` is the default ordering; `before`/`after`/`requires` are hard
edges that override it.** `STAGE_ORDER` (`core/src/constants/stages.ts`) is a
fixed 20-entry list — `SCAFFOLD` → `GITIGNORE` → `NAMING` → … → `ENV` →
`FINALIZE` — and every feature declares one (`stage` is a required field).
The orchestrator (`resolveExecutionOrder` / `topoOrder` in
`core/src/orchestrator.ts`) builds a dependency graph from `requires`,
`after` and `before`, then runs a stage-then-id-stable topological sort
(Kahn's algorithm) over it.

Two things about that sort are easy to get backwards:

- **Edges win over stage order, not the other way round.** Stage is only the
  tiebreak used to pick among features that are *simultaneously ready*; it
  orders the unconstrained majority and never overrides an explicit edge. A
  `requires`/`after`/`before` edge will happily pull a feature across a stage
  boundary — a `FINALIZE` feature that a `SCAFFOLD` feature declares `after`
  runs *before* that `SCAFFOLD` feature. `core/test/orchestrator.test.ts`
  pins exactly this behaviour.
- **`requires` is not blocking, and is not distinct from `after`.** All three
  edge kinds funnel into the same `addEdge`, which silently drops the edge
  when either endpoint isn't in the run. A missing or disabled `requires`
  target never errors — it just contributes no ordering constraint. `before`
  is the inverse edge of `after`; `requires` is a synonym of `after` that
  documents intent.

A genuine cycle in `requires`/`after`/`before` throws before anything
executes.

**`failureIsNonFatal`** on a feature means its `execute()`/`update()` throw
is caught and the run continues instead of aborting the whole scaffold. It's
honoured in two places: the orchestrator catches `execute()` and logs a
warning (`core/src/orchestrator.ts`), and `battlestack pull` catches
`update()` and prints a failure line (`cli/src/commands/pull.ts`). It's a
common marker rather than an exotic one — 21 of `preset-nuxt4`'s 39 features
set it, `shared:github` (the GitHub Actions quality-gate feature) among them:
a future template misconfiguration in one such feature shouldn't fail an
entire scaffold that's otherwise fine.

**Deploy targets are an open registry, not a union type.** `DeployTarget` is
just `{ id, label, description? }`, and any plugin can `addDeployTarget()`
one. `shared:github`, the public quality-gate feature, has zero knowledge of
what deploy targets exist or what they need — it emits a generic CI workflow
and nothing else. A plugin that wants an actual deploy pipeline (build an
image, push it, roll out to *its* target) registers its own feature that
does that, entirely separately; there's no code in the public preset that
enumerates `ctx.registries.deployTargets` at all today, because the one
feature that used to need to (the old, single hardcoded-union version of
`shared:github`) doesn't need to know anymore. This is the shape to follow
if you're adding deploy-target-specific behavior: keep it in the
target-owning plugin, not in a generic feature.

## 6. The two injectable seams

Two small "port" modules exist purely to prevent dependency cycles, and both
follow the same shape: an interface, a module-level `current` variable
defaulting to a harmless no-op implementation, a `set*` function the CLI
calls once at startup, and a `get*` function everything else calls.

- **`ui-port.ts`** (`core`) — `core` code occasionally needs to print a
  debug trace, a best-effort warning, or pause a spinner around a child
  process. It can't import `cli`'s real terminal-UI implementation (that
  would be the same cycle `tui` exists to avoid, one level down — `core`
  has no business depending on `cli` or `tui`). So `core` calls through
  `getUiPort()`, which defaults to a silent-ish `console.warn`/`console.log`
  fallback; `cli` installs the real spinner-backed implementation via
  `setUiPort()` during its own startup. Tests and any other consumer of
  `core` standalone keep working with the default, no CLI required.
- **`host-services.ts`** (`core`) — a preset feature's *project command*
  sometimes needs something that only makes sense at the CLI level — e.g.
  `preset-nuxt4`'s `nuxt4:scaffold` `dev` command wants to bootstrap a fresh
  checkout (write `.env`, install deps) and bring up the CLI's dev gateway.
  Those behaviors live in `@battlestack/cli`, which the preset can't import
  (presets are loaded *by* the CLI as plugins — that's the cycle). The
  preset calls `getHostServices()` instead; `cli` installs the real
  implementations via `setHostServices()` at startup. When nothing is
  installed (a test, some other host), the optional methods are just absent
  and callers fall back gracefully.

Both exist for the identical reason `tui` exists as its own package (§1) —
this codebase has exactly one structural rule that recurs at every layer:
nothing "lower" (`core`) imports anything "higher" (`cli`, a preset), even
transitively, even for one function call. When a lower layer still needs to
*reach* a capability that only a higher layer can provide, it goes through
an injected seam instead of an import.

## 7. Compatibility gate

`core` exports `BATTLESTACK_PLUGIN_API_VERSION` (currently `1`). A plugin
declares the version it was built against via
`defineBattlestackPlugin({ apiVersion })`. `applyPlugin()` (`core/src/plugin.ts`)
checks this at load time and throws immediately — before the plugin's
`register()` even runs — on any mismatch, with a message naming the plugin
and both version numbers, rather than letting a stale plugin fail
confusingly deep inside registration or at scaffold time. The comparison is
`Math.trunc(plugin.apiVersion) !== BATTLESTACK_PLUGIN_API_VERSION`, so it is
a coarse, whole-number gate with no minor/patch compatibility ranges — a
declared `1.5` is truncated to `1` and accepted. Bump it only for an actual
breaking change to the `BattlestackPluginContext` surface.

## 8. Known rough edges

Worth knowing about rather than discovering by surprise:

- **No `extendFramework`.** A plugin can add features and extend templates,
  but it cannot add an id to a framework's `supportedFeatures` list — there
  is no equivalent hook for frameworks. `supportedFeatures` is the catalog
  `battlestack add` validates a requested id against — after resolving it
  through the registry, `add` rejects anything the framework doesn't
  advertise — so a plugin-contributed feature meant to be individually
  addable (as opposed to arriving forced-on via `extendTemplate`'s
  `addFeatures`) still depends on the framework's own package advertising
  its id, even for a feature the framework's package doesn't itself
  register. (`remove` doesn't consult the catalog; it only requires the id
  to be recorded in the project manifest.) `preset-nuxt4` accommodates this
  today for exactly one id, `nuxt4:fontawesome` — a feature that moved to a
  private plugin and comes back optional: the id stays listed in
  `supportedFeatures` even though nothing in `preset-nuxt4` registers it,
  purely so `add` doesn't reject it when the plugin that does register it is
  installed.
- **The `supportedFeatures` catalog can also drift the other way.**
  `nuxt4:auth-verification` *is* registered by `preset-nuxt4` but is missing
  from the catalog, so `battlestack add nuxt4:auth-verification` is rejected
  for a feature that genuinely exists. Nothing cross-checks the two lists.
- **Feature ordering edges are not namespace-safe.** `finalizeRegistries`
  canonicalizes every id-bearing field it knows about via a role table, but
  there is no such table for `Feature` — `requires`/`after`/`before` are
  never rewritten, and `topoOrder` keys its map on the bare authored id. A
  cross-plugin ordering edge therefore silently no-ops rather than failing
  loudly (§5).
- **Template extensions can add features, not files.** `extendTemplate`'s
  doc comment in `core/src/plugin.ts` reads "features (and, later, files)",
  and the `TemplateExtension` type echoes it with "(and, later, template
  files)" — but file-level template extension (a plugin patching or
  appending to a file another plugin's feature emits) isn't implemented; the
  type carries only `templateId`, `addFeatures?` and `addOptionalFeatures?`.
  A plugin that
  needs to change generated output beyond adding a whole new feature has no
  hook for it today; it has to own the entire file itself.
- **The plugin API version gate is whole-number only.** There's no
  minor/patch negotiation — the declared version is truncated to a whole
  number and compared for equality, so any *major* mismatch is a hard
  failure and a fractional `apiVersion` is silently rounded down. Fine for a
  young plugin ecosystem with one real consumer; will need revisiting if
  third-party plugins proliferate and a breaking change becomes rarer than a
  plugin lagging behind by one patch release.
- **`noUncheckedIndexedAccess` is off** in `tsconfig.base.json`, unlike the
  original monolith. Turning it on today produces 17 errors across seven
  files: one index read each in `core/src/plugin.ts` and `core/src/registry.ts`
  that an existing guard already makes safe but TypeScript can't narrow, plus
  15 across five test files (`core/test/plugin-loading.test.ts`,
  `core/test/finalize.test.ts`, `preset-nuxt4/test/github.test.ts`,
  `gitignore.test.ts`, `ci.test.ts`) — which count, because `pnpm tsc` covers
  `test` as well as `src`. Left off until someone adds the non-null
  assertions/guards needed, rather than shipping a permanently-red
  `pnpm tsc`.
