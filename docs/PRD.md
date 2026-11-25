# Product requirements: battlestack

First written retrospectively, after battlestack already shipped, and kept
current since. It describes what it is for, what it commits to, and what it deliberately refuses to do, so
there is a reference for deciding what belongs in it next.

Scope is the public CLI and the Nuxt 4 preset. Capabilities distributed as
separate plugins are specified by whoever owns them, not here.

| | |
| --- | --- |
| **Product** | battlestack, a scaffolding CLI for Nuxt 4, published to npm as `battlestack` and five `@battlestack/*` packages |
| **Status** | Living document. Describes the product as built; the latest release is the top entry of `CHANGELOG.md` |
| **Owner** | SevenLab, which builds it and uses it to start its own and its clients' projects |
| **Visibility** | Public repository with a `LICENSE` and `CONTRIBUTING.md`, open to outside contributors |

---

## 1. Executive summary

A scaffolding CLI that assembles a project from versioned, composable features
instead of copying a frozen template, and that records which feature versions
produced which files so a project created months ago can still receive upstream
fixes.

The one-line test of whether it works: `npx battlestack@latest my-app` gives you
a running application, not a folder of TODOs.

What it is made of, in short:

- **One CLI with two modes.** Outside a project it scaffolds; inside one it is a
  maintenance tool (`pull`, `doctor`, `add`, `own`, `sync` and the commands each
  installed feature contributes).
- **One public preset.** `@battlestack/preset-nuxt4` registers the `nuxt4`
  framework, three templates (`nuxt4-minimal`, `nuxt4-fullstack`, `nuxt4-ai`)
  and 41 features, through the same plugin API any third party uses.
- **A manifest per generated project** (`.battlestack/manifest.json`) that
  records, per feature, its version and a content hash per emitted file. Every
  "staying current" capability is built on it.
- **A public plugin API** (`defineBattlestackPlugin()`, API version 1) for
  features, templates, commands, frameworks and deploy targets.

---

## 2. Problem statement

Starting a serious Nuxt project means wiring the same things every time: auth,
Postgres, migrations, Docker, CI, health checks, agent configuration. At SevenLab
that cost days per project before the first line of product code.

Starters and boilerplates solve half of it. They hand you the wiring once, and
from that moment your copy drifts. A fix made upstream never reaches you, and
after a few months the starter is a liability you maintain alone.

So the unsolved half is not generation. It is staying current after generation.

---

## 3. Goals

A new project should run immediately after scaffolding, with no manual wiring
step. A project scaffolded months ago should be able to adopt upstream fixes
without losing local edits. The tool should be able to tell you, on demand, what
is wrong with a project and what has drifted from what it generated.

Defaults should be safe in production rather than merely convenient in
development. Anyone should be able to extend the tool through the same API the
built-in preset uses. Generated projects should be legible to an AI agent from
day one. And all of it should work without a SevenLab account, service, or
credential.

Section 16 says how we would know each of these holds, and which of those
signals are actually measured.

---

## 4. Users and roles

**The SevenLab engineer.** Starts client and internal projects regularly, needs
them consistent, and needs a fix made once to reach every project. This is the
primary audience and the reason the drift mechanism exists at all.

**The outside developer.** Wants a well-configured Nuxt app without adopting an
agency's entire way of working. Must be able to use the tool with no SevenLab
relationship, credentials, or hosted service.

**The AI coding agent.** Increasingly the thing actually editing the code. Needs
generated conventions it can read, scoped to what the project actually contains.

That third audience is a real requirement rather than a nice-to-have. A generated
project carries an `AGENTS.md` written from the features that are enabled, and
MCP server configuration for exactly what was turned on.

Two further roles exist because of the plugin API and the public repository,
though neither is a target audience in the same sense:

**The plugin author.** Writes a feature, template or command in a separate npm
package, public or private, and relies on the plugin API and its version gate
staying stable (sections 7.3 and 10).

**The battlestack contributor.** Changes the CLI or the preset itself, and is
bound by the rules in `CONTRIBUTING.md`: feature version bumps, changelog
entries, and tests that can fail (section 16).

There are no accounts and therefore no permission roles. The CLI runs with the
rights of whoever runs it.

---

## 5. Product surface

### 5.1 Two modes

The CLI picks its mode by walking up from the current directory looking for a
manifest.

| Mode | Where | What it offers |
| --- | --- | --- |
| **Scaffold mode** | Outside a battlestack project | `battlestack [name] [template] [options]`, plus project-agnostic builtins: `templates`, `features`, `plugins`, `skills`, `init`, `self-update` and the `plugin` family |
| **Project mode** | Inside one | Maintenance commands (`describe`, `doctor`, `cleanup`, `install`, `add`, `remove`, `own`, `disown`, `rename`, `pull`/`upgrade`, `bump`, `sync`, the `gateway:*` and `mitm` commands) plus the commands contributed by the features the manifest lists |

`battlestack --help` inside a project shows only the commands of features that
are installed. `bstack` is an alias for `battlestack` everywhere.
[docs/commands.md](commands.md) is the full reference.

### 5.2 Templates

A template is a curated list of required and optional features, not a folder
that gets copied.

| Template | Gets you | Needs Docker |
| --- | --- | --- |
| `nuxt4-minimal` | Nuxt 4 + Nuxt UI v4 + Tailwind v4, i18n, Pinia, a real `/api/health`, production Dockerfile and CI. No database, no auth. | No |
| `nuxt4-fullstack` | The above plus Postgres, Drizzle, session auth, Mastra and Docker Compose. | Yes |
| `nuxt4-ai` | Full stack plus Mastra agents and streaming chat behind an OpenAI-compatible AI gateway (sluis.ai preset). | Yes |

### 5.3 Feature catalog

Feature ids are namespaced: `nuxt4:*` features are specific to the Nuxt
framework, `shared:*` features are not. The catalog groups them as auth, data,
AI, app surface, ops and quality, and always-present plumbing.
[docs/features.md](features.md) lists every feature.

### 5.4 Packages

| Package | What it is |
| --- | --- |
| `battlestack` | The `npx battlestack` entry point and the only package with `bin` entries; a thin wrapper around `@battlestack/cli` |
| `@battlestack/cli` | Arg parsing, plugin discovery and loading, command dispatch, the project-mode command table |
| `@battlestack/core` | The plugin SDK: types, registries, loader and the orchestrator that turns enabled features into an execution plan |
| `@battlestack/preset-nuxt4` | The Nuxt 4 preset, loaded as a bundled plugin |
| `@battlestack/tui` | Shared terminal UI (prompts, spinners, banner), split out to break a preset → cli dependency cycle |
| `@battlestack/theme` | The Nuxt UI theme generated projects use: light and dark tokens, brand assets, the logo |

---

## 6. The decisions that shaped it

These settle most arguments about whether something belongs.

**Assembled, never copied.** A template is a curated list of features. Two
projects from the same template at different times are built from the feature
versions current at each moment. Everything about staying current depends on
this.

**Never silently overwrite someone's work.** For a drifted file, `pull` stages a
diff and a candidate rather than applying it. Discarding edits in order to
deliver an update would make the whole update mechanism untrustworthy, which
costs more than any single update is worth.

**Fail before writing, not halfway through.** Environment checks run before any
file is created, so a missing Docker daemon produces a refusal rather than a
half-written project.

**Honest signals.** `/api/health` performs a real database ping and
configuration check instead of returning a static 200. `doctor` reports what is
actually wrong. A check that cannot fail is worse than no check, because it
manufactures confidence.

**Safe by default, convenient by exception.** Development conveniences are gated
on more than one condition. `battlestack login` requires a non-production
environment *and* a request host that resolves locally, so a dev-tagged server
exposed through a tunnel still refuses.

**Say what is not true.** Where support is unverified, the documentation says so
rather than rounding up. An untested combination is recorded as unknown, not as
working.

---

## 7. What it has to do

Everything in this section is satisfied today. It is written down so a
regression is arguable rather than a matter of taste.

### 7.1 Scaffolding

Create a runnable project from one command with no prior install. Prompt for
template and optional features, and support a fully non-interactive run for CI.
Validate the environment before writing and abort on a failed required check.
Support pnpm, npm and bun for the generated project; yarn is explicitly
unsupported. Offer a dry run that prints the plan and writes nothing. Derive
per-project service ports, probe them and freeze them, so several projects run
side by side without collision.

How that surfaces today:

- Non-interactive runs take the template positionally or with `-t`, and
  `-y/--yes` accepts every default. `--features` and `--disable` force optional
  features on or off.
- `--pm <pnpm|npm|bun>` sets the generated project's package manager; the
  lockfile, install, production Dockerfile and GitHub Actions workflow follow
  it. Generated prose does not yet (section 15).
- A scaffold that stopped partway is recovered by re-running with `--force`,
  which recreates only the target directory.
- Ports are written to `.env` on the first run; a held port is changed there.
- `--gateway` opts into the shared Traefik gateway and an HTTPS hostname
  `https://<name>.battlestack.test`.

### 7.2 Maintenance

Record every emitted file against the feature version and content hash that
produced it. Re-apply upstream changes, skipping features whose version has not
moved. Detect drift per file and stage a diff rather than overwriting. Let a
user claim permanent ownership of a path. Diagnose a project read-only, covering
drift, configuration and environment. Bootstrap a cloned project in one command.
Update dependencies separately from template content.

`pull` sorts every file a feature owns into one of five outcomes:

| Situation | What happens |
| --- | --- |
| **Pristine**: untouched since battlestack wrote it | Updated in place |
| **Missing**: deleted by the user | Restored, and reported |
| **Converged**: the user's edit matches the new version | Recorded as up to date; nothing written |
| **Owned**: claimed with `battlestack own` | Skipped entirely |
| **Drifted**: edited, and upstream changed too | Not overwritten; `.battlestack/pull/<path>.new` and `.patch` are staged instead |

`--force` overwrites drifted files after saving each as
`.battlestack/pull/<path>.bak`; `--overwrite` overwrites every shipped file and
confirms first if any are owned. `bump` updates dependencies, `sync` runs
`pull`, `bump` and `doctor` in that order, and `install` writes `.env`,
installs dependencies and applies the schema in a fresh clone. `rename` renames
a project; renaming its directory does not.
[docs/keeping-projects-current.md](keeping-projects-current.md) covers the
routine.

### 7.3 Extension

Register features, templates, commands, frameworks and deploy targets through a
public, versioned plugin API. Let a plugin extend a template it does not own,
independent of load order. Load plugins from a per-machine store, so extending
the CLI does not add a dependency to the shipped application. Check plugin API
compatibility at load and refuse a mismatch with a clear message. Permit a
private plugin to extend a public template without the public code referencing
it.

Plugins load from four sources, first occurrence wins:

| Source | How | Failure to load |
| --- | --- | --- |
| env | `BATTLESTACK_PLUGINS` | Fatal |
| project | `plugins` in `battlestack.config.json` | Fatal |
| store | `battlestack plugin add` | Warns, continues |
| bundled | Ships with the CLI (the Nuxt preset) | Fatal |

Store plugins can be listed, updated and set to update automatically
(`off`, `notify` by default, or `apply`); updates respect the release-age
window, and a version that fails to load is rolled back.
[docs/plugins.md](plugins.md) is the practical guide.

### 7.4 Quality of what it emits

A production container image and a real health endpoint. Migrations that track
what has been applied and are safe to re-run. Secrets generated with real
entropy per project, never a shipped placeholder. Agent-readable conventions
generated from the enabled features only. A supply-chain release-age policy
applied to dependency updates.

Specifics that make those claims checkable:

- `GET /api/health` returns `{ status, version, commit, builtAt, checks }`, 503
  when degraded (on by default), with the database ping bounded by
  `health.dbTimeoutMs` (default 1000 ms). Without a database it still checks
  required configuration.
- `AGENTS.md` keeps the house rules plus one pointer line per enabled feature to
  `docs/battlestack/<feature>.md`; `CLAUDE.md` is a one-line pointer to it.
  `.mcp.json` registers MCP servers only for what is enabled (Nuxt UI, Mastra,
  Playwright).
- `shared:package-policy` holds new dependency releases back for 3 days, written
  into the config of whichever package manager the project uses.

---

## 8. Non-functional requirements

### 8.1 Constraints

Node 24 or newer is the single hard requirement. Docker is needed only for
templates with a database.

macOS, Windows and Linux are supported targets, and Windows is verified in CI by
scaffolding a real project rather than assumed. Local HTTPS hostnames need mkcert
and are unavailable on WSL2; absence degrades to a localhost port rather than
failing. Hosts-file automation covers macOS and Windows only.

The publishable packages share one lockstep version. Feature versions are
independent of it, and are content markers rather than release numbers.

### 8.2 Further requirements drawn from the repository

| Ref | Requirement |
| --- | --- |
| **NFR-1** | **No telemetry, no account.** Nothing in the CLI reports usage or phones home (section 16.2 explains the trade). |
| **NFR-2** | **Feature version discipline.** A change to a feature's output bumps its version; a change to `collectDocs` or `collectEnv` output also bumps the feature that writes the file (`nuxt4:docs`, `shared:env`). CI enforces this with the feature version bump check. |
| **NFR-3** | **Template payload is LF.** `packages/*/templates/**` is copied verbatim into projects, so `.gitattributes` keeps it LF and the Windows CI job asserts it. |
| **NFR-4** | **Tests must be able to fail.** Fixtures are built through the real loader path, and a test of a mutual-exclusion property includes the run with the mechanism disabled (`CONTRIBUTING.md`). |
| **NFR-5** | **CI works on a stranger's fork.** All CI runs on hosted runners. |
| **NFR-6** | **Plugin API stability.** `BATTLESTACK_PLUGIN_API_VERSION` is `1` and is bumped only for a breaking change to the plugin context. |
| **NFR-7** | **Supply chain for the tool itself.** `self-update` and plugin updates respect the release-age window unless `--force` is passed; npm publishing uses Trusted Publishing (OIDC). |

---

## 9. Data model overview

battlestack has no database of its own. Its state is a handful of files.

| File | Scope | What it holds |
| --- | --- | --- |
| `.battlestack/manifest.json` | Per project, committed | `schemaVersion`, `cliVersion`, `framework`, `template`, `packageManager`, `projectName` with `previousNames` and `renderedName`, `createdAt`/`updatedAt`, an `incomplete` flag set while a scaffold or pull is in flight, `features[]`, `optedOut[]` and `policies` |
| `features[]` entries | Inside the manifest | `id`, `version`, `files` (relative path → content hash at install time), `ownedByUser[]`, free-form `state` for later migrations |
| `.battlestack/local.json` | Per developer, gitignored | Gateway enablement and hostname |
| `.battlestack/pull/` | Per project, transient | `.new`, `.patch` and `.bak` artefacts from `pull`, cleared by `cleanup` |
| `battlestack.config.json` | Per project, optional | Project-declared plugins |
| Plugin store | Per machine | Plugins installed with `battlestack plugin add` |

The manifest is the source of truth for `pull`. Features removed with
`battlestack remove` are listed in `optedOut` and never rehydrated.

---

## 10. Architecture

Projects are built in three layers: **framework → template → feature**.
`@battlestack/core` holds the registries and the orchestrator; it depends on
neither the CLI nor any preset, because the CLI loads presets as plugins at
runtime. The preset is major-versioned (`preset-nuxt4`, not `preset-nuxt`) so a
future `preset-nuxt5` can register alongside it without id collisions.

A feature is a versioned unit with `collect*` hooks (dependencies, env entries,
docs sections, Nuxt modules, agent skills, build secrets) aggregated across
every enabled feature, plus lifecycle methods. Features run in coarse stages and
are ordered within a stage by `before`/`after` edges.

[docs/architecture.md](architecture.md) is the reference, including its
section on known rough edges: no `extendFramework` hook, a `supportedFeatures`
catalog that can drift from what is registered, ordering edges that are not
namespace-safe, template extensions that add features but not files, a
whole-number-only API version gate, and `noUncheckedIndexedAccess` left off.

---

## 11. Environments and delivery

This is a CLI distributed through npm, so there are no hosted environments. What
exists instead is a branch and release model.

| Ref | Meaning |
| --- | --- |
| `main` | Integration branch. Every merge runs CI. Merging publishes nothing. |
| `production` | The commit behind the current `latest` on npm, moved only by the Release workflow |
| `v<version>` tag | A version npm accepted, created after the publish succeeds |
| `release/v<version>` | Machine-owned version bump branch opened by Prepare release |

A stable release is: Prepare release (bumps every package, prepends a
`CHANGELOG.md` stanza, opens a `release: v<version>` PR), a reviewed merge, then
the Release workflow behind an environment approval, whose gate re-runs the
lockstep check, typecheck, tests, build and the packed-tarball smoke test.
Prereleases publish under the `next` dist-tag and do not move `production`.
[docs/releasing.md](releasing.md) has the details.

`main` is protected by two stacked rulesets: an organisation ruleset (one
approving review, resolved threads, no force-push) and a repository ruleset that
requires every CI job to pass. CI also runs daily, so upstream breakage of the
unpinned scaffold jobs shows up on `main` first. See
[docs/repository-settings.md](repository-settings.md).

For generated projects, battlestack emits the production image, a compose stack
and the health endpoint; where that runs is the user's choice
([docs/deployment.md](deployment.md)).

---

## 12. Out of scope

Each of these has been asked for, and each is a deliberate no.

**Not a framework.** It generates Nuxt applications and adds no runtime
abstraction of its own on top of Nuxt.

**Not a deployment platform.** It emits a production image and an honest health
endpoint. Choosing and driving a platform is the user's job, or a plugin's.

**Not a hosted service.** The CLI is the product. Nothing phones home, and there
is no account.

**Not multi-framework today.** The plugin API permits other frameworks. The
public preset targets Nuxt 4 only, and claiming otherwise would be a claim we
cannot support.

**Not a generator you re-run to produce features.** Features are versioned units
maintained upstream, not one-shot templates you fork.

---

## 13. Roadmap

There is no committed roadmap in the repository. Work is driven by the
`## Unreleased` section of `CHANGELOG.md` and by the gaps the docs already name.
The items below are those named gaps; none has a date.

| Item | Where it is recorded |
| --- | --- |
| Support for `nuxt-auth-utils` 0.6, with a `pull` migration for the session env var | `CHANGELOG.md`, Unreleased: "support for it follows in its own release" |
| `--pm` reaching generated prose, agent rules and skills | `README.md`, "Choosing a package manager"; open question below |
| The rough edges listed in `docs/architecture.md` §8 | `docs/architecture.md` |
| bun × `nuxt4-fullstack` verification, and running the pack-smoke matrix in CI | `CONTRIBUTING.md` |

The repository records these as gaps, not as planned work, and their order is
not decided.

---

## 14. Risks

**Drift can make updates unusable.** If most files in a mature project have
drifted, `pull` becomes a wall of diffs nobody reads, and staying current fails
in practice while appearing to work. File ownership, structural files marked as
the user's from the start, and keeping generated files small enough to review are
the mitigations. This is the one worth watching as projects age.

**Feature version discipline.** A feature whose output changes without a version
bump reaches new scaffolds and no existing project. It is the most damaging
mistake available here, which is why CI gates it instead of leaving it to review.

**Breadth outrunning maintenance.** Every feature is a maintenance commitment
across three templates. The plugin API exists partly so narrow needs can live
outside the public catalog.

**One framework, one ecosystem.** Nuxt majors move. The preset is versioned for
coexistence, so a future preset can register alongside rather than replace.

**Unpinned upstream modules.** Scaffolds install current upstream releases, so
a breaking upstream release can break every fresh scaffold once it clears the
release-age window. The daily CI run, the 3-day window and pinning a module
until support lands are the mitigations.

---

## 15. Open questions

Does `--pm` need to reach generated prose and agent rules, which still spell
commands as pnpm? It is a known gap, documented rather than hidden.

Should the chat feature's `http` transport be removed rather than shipped and
documented as not production-ready?

What is the threshold for promoting a plugin-provided feature into the public
catalog?

Is there a case for a curated plugin index, and what would make it worth the
maintenance? Not built, and deliberately undocumented until it is.

Should the package-manager matrix in `CONTRIBUTING.md` run in CI, given that it
can go stale between manual runs without anything turning red?

---

## 16. Acceptance and verification

### 16.1 A change is done when

1. Every check in `ci.yml` is green: the feature version bump check (which also
   runs the lockstep version check), the changelog entry check, type-check and
   test on Node 24 and 26, the Windows jobs on Node 24 and 26 (type-check, test,
   build, CLI smoke, real `nuxt4-fullstack` scaffold), the scaffold job that runs
   a generated project's own lint, typecheck and tests against Postgres and
   RustFS, and the theme-layer scaffold and build.
2. A change under `packages/` has a line under `## Unreleased` in
   `CHANGELOG.md`, or the `skip-changelog` label with a reason.
3. A change to a feature's output bumps that feature's version, and the writing
   feature's version when it goes through `collectDocs` or `collectEnv`.
4. New assertions have been seen to fail with the behaviour removed.
5. Changes to package-manager support re-run `pnpm pack:smoke` and
   `pnpm pack:smoke:matrix` and update the matrix in `CONTRIBUTING.md`.
6. One approving review on the pull request.

### 16.2 How we would know it is working

There is no telemetry, and none is planned. Nothing in the CLI reports usage, so
every measure below is either observable from outside or has to be gathered by
asking. That is a deliberate trade: it costs us measurement and buys a tool that
requires no trust from the person running it.

Stated plainly so nobody quotes a number that does not exist:

| Signal | How we would get it | Instrumented today |
| --- | --- | --- |
| Time from empty directory to running app | Measured by hand, per template | No |
| Projects that take a `pull` cleanly after months | Asking the teams that own them | No |
| Fixes made once that reach existing projects | Countable from feature version history | By hand |
| Scaffolds that fail partway | Issue reports only | No |
| Outside adoption | Package downloads, issues from non-members | Downloads only |

The test we actually apply: a SevenLab engineer starting a project reaches
product code the same day, and a project six months old can take an upstream
security fix without a rewrite.

---

## 17. Glossary

| Term | Meaning |
| --- | --- |
| **Feature** | A versioned unit that contributes files, dependencies, env vars, docs sections and commands to a project |
| **Feature version** | A feature's semver, bumped when its output changes; unrelated to the package release number |
| **Template** | A curated list of required and optional features for one framework |
| **Framework** | The target a template generates for; `nuxt4` is the only public one |
| **Preset** | A plugin that registers a framework with its templates and features; `@battlestack/preset-nuxt4` |
| **Plugin** | An npm package built with `defineBattlestackPlugin()` that registers into the CLI's registries |
| **Plugin store** | The per-machine location for plugins installed with `battlestack plugin add` |
| **Fully-qualified id** | The namespaced id a feature is registered under, such as `nuxt4:nuxt4:database`, as opposed to the bare authored id |
| **Manifest** | `.battlestack/manifest.json`, the per-project record of feature versions and file hashes |
| **Drift** | A tracked file whose content differs from the hash battlestack recorded |
| **Owned file** | A path the user claimed with `battlestack own`; `pull` skips it |
| **Scaffold mode / project mode** | The CLI outside a project versus inside one |
| **Lockstep version** | The single version all six publishable packages share |
| **Release-age policy** | Holding back dependency releases younger than 3 days |
| **Gateway** | The shared local Traefik proxy serving `https://<name>.battlestack.test` |
| **AI gateway** | The OpenAI-compatible endpoint the AI templates call; sluis.ai is the default preset |

---

## 18. Reference documents

[docs/architecture.md](architecture.md) for how the plugin system and
package split work. [docs/features.md](features.md) for the current catalog.
[docs/plugins.md](plugins.md) for extending it.
[CONTRIBUTING.md](../CONTRIBUTING.md) for the rules these principles become at
review time.

| Path | What it holds |
| --- | --- |
| [docs/README.md](README.md) | Index of the user documentation |
| [docs/commands.md](commands.md) | Every command and flag |
| [docs/templates.md](templates.md) | The three templates |
| [docs/keeping-projects-current.md](keeping-projects-current.md) | `pull`, drift, ownership |
| [docs/deployment.md](deployment.md) | Image, compose, health checks |
| [docs/releasing.md](releasing.md) | How a release is cut |
| [docs/repository-settings.md](repository-settings.md) | Rulesets and required CI checks |
| [CHANGELOG.md](../CHANGELOG.md) | Release history and unreleased changes |
