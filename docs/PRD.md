# Product requirements: battlestack

Written retrospectively at v0.1.0. battlestack exists and ships; this describes
what it is for, what it commits to, and what it deliberately refuses to do, so
there is a reference for deciding what belongs in it next.

Scope is the public CLI and the Nuxt 4 preset. Capabilities distributed as
separate plugins are specified by whoever owns them, not here.

## The problem

Starting a serious Nuxt project means wiring the same things every time: auth,
Postgres, migrations, Docker, CI, health checks, agent configuration. At SevenLab
that cost days per project before the first line of product code.

Starters and boilerplates solve half of it. They hand you the wiring once, and
from that moment your copy drifts. A fix made upstream never reaches you, and
after a few months the starter is a liability you maintain alone.

So the unsolved half is not generation. It is staying current after generation.

## What battlestack is

A scaffolding CLI that assembles a project from versioned, composable features
instead of copying a frozen template, and that records which feature versions
produced which files so a project created months ago can still receive upstream
fixes.

The one-line test of whether it works: `npx battlestack@latest my-app` gives you
a running application, not a folder of TODOs.

## Who it is for

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

## What it is trying to achieve

A new project should run immediately after scaffolding, with no manual wiring
step. A project scaffolded months ago should be able to adopt upstream fixes
without losing local edits. The tool should be able to tell you, on demand, what
is wrong with a project and what has drifted from what it generated.

Defaults should be safe in production rather than merely convenient in
development. Anyone should be able to extend the tool through the same API the
built-in preset uses. Generated projects should be legible to an AI agent from
day one. And all of it should work without a SevenLab account, service, or
credential.

## What it refuses to do

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

## The decisions that shaped it

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

## What it has to do

Everything here is satisfied today. It is written down so a regression is
arguable rather than a matter of taste.

**Scaffolding.** Create a runnable project from one command with no prior
install. Prompt for template and optional features, and support a fully
non-interactive run for CI. Validate the environment before writing and abort on
a failed required check. Support pnpm, npm and bun for the generated project;
yarn is explicitly unsupported. Offer a dry run that prints the plan and writes
nothing. Derive per-project service ports, probe them and freeze them, so several
projects run side by side without collision.

**Maintenance.** Record every emitted file against the feature version and
content hash that produced it. Re-apply upstream changes, skipping features whose
version has not moved. Detect drift per file and stage a diff rather than
overwriting. Let a user claim permanent ownership of a path. Diagnose a project
read-only, covering drift, configuration and environment. Bootstrap a cloned
project in one command. Update dependencies separately from template content.

**Extension.** Register features, templates, commands, frameworks and deploy
targets through a public, versioned plugin API. Let a plugin extend a template it
does not own, independent of load order. Load plugins from a per-machine store,
so extending the CLI does not add a dependency to the shipped application. Check
plugin API compatibility at load and refuse a mismatch with a clear message.
Permit a private plugin to extend a public template without the public code
referencing it.

**Quality of what it emits.** A production container image and a real health
endpoint. Migrations that track what has been applied and are safe to re-run.
Secrets generated with real entropy per project, never a shipped placeholder.
Agent-readable conventions generated from the enabled features only. A
supply-chain release-age policy applied to dependency updates.

## Constraints

Node 24 or newer is the single hard requirement. Docker is needed only for
templates with a database.

macOS, Windows and Linux are supported targets, and Windows is verified in CI by
scaffolding a real project rather than assumed. Local HTTPS hostnames need mkcert
and are unavailable on WSL2; absence degrades to a localhost port rather than
failing. Hosts-file automation covers macOS and Windows only.

The five published packages share one lockstep version. Feature versions are
independent of it, and are content markers rather than release numbers.

## How we would know it is working

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

## Risks

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

## Open questions

Does `--pm` need to reach generated prose and agent rules, which still spell
commands as pnpm? It is a known gap, documented rather than hidden.

Should the chat feature's `http` transport be removed rather than shipped and
documented as not production-ready?

What is the threshold for promoting a plugin-provided feature into the public
catalog?

Is there a case for a curated plugin index, and what would make it worth the
maintenance? Not built, and deliberately undocumented until it is.

## Related

[architecture.md](architecture.md) for how the plugin system and package split
work. [features.md](features.md) for the current catalog.
[plugins.md](plugins.md) for extending it. [CONTRIBUTING.md](../CONTRIBUTING.md)
for the rules these principles become at review time.
