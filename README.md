# battlestack

[![npm version](https://img.shields.io/npm/v/battlestack?logo=npm)](https://www.npmjs.com/package/battlestack)
[![npm downloads](https://img.shields.io/npm/dm/battlestack)](https://www.npmjs.com/package/battlestack)
[![CI](https://github.com/SevenLabnl/battlestack/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/SevenLabnl/battlestack/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/battlestack)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/battlestack)](LICENSE)

A scaffolding CLI for Nuxt 4. You answer a few questions and get a Nuxt app
that runs, with Docker and CI set up and, if you want them, auth and a database.

```bash
npx battlestack@latest my-app
cd my-app
battlestack dev
```

Then open the URL it prints.

## Quick start

Run it with whichever package manager you already have. None of these need an
install first:

```bash
npx battlestack@latest my-app
pnpm dlx battlestack@latest my-app
bunx battlestack@latest my-app
```

Keep `@latest` in there. Without it, `npx` can reuse an older copy from its
cache.

Some common variations:

```bash
# Pick the template up front, accept every default (good for CI)
npx battlestack@latest my-app nuxt4-fullstack --yes

# Plain Nuxt app, no database, no Docker needed
pnpm dlx battlestack@latest my-app nuxt4-minimal

# Keep the generated project on npm or bun instead of pnpm
npx battlestack@latest my-app --pm npm
bunx battlestack@latest my-app --pm bun

# See what would be generated without writing anything
npx battlestack@latest my-app nuxt4-ai --dry-run

# Leave out optional features you don't want
npx battlestack@latest my-app --disable nuxt4:storage,nuxt4:rag

# Try the next release before it ships
npx battlestack@next my-app
```

If you scaffold often, install it globally so `battlestack` (or the short
`bstack`) is always on your PATH:

```bash
pnpm add -g battlestack   # or: npm i -g battlestack, bun i -g battlestack
battlestack my-app
```

## Why this exists

Every new project at SevenLab used to start the same way. Scaffold Nuxt, then
spend days on auth, Postgres, migrations, Docker, CI, health checks and agent
config before writing any product code. Starter kits help with the first day,
but once you copy one, your project and the starter go their separate ways.
Fixes made upstream never reach you.

battlestack builds the project from versioned features instead of copying a
fixed template. Each generated project keeps a manifest of which feature
versions wrote which files. That lets `battlestack pull` bring upstream fixes
into a project you scaffolded months ago, and lets `battlestack doctor` tell
you where your project has drifted.

## Before you start

You need **Node 24 or newer**. Check with `node -v`.

You need **Docker** only for the templates with a database (`nuxt4-fullstack`
and `nuxt4-ai`), which run Postgres in a container. `nuxt4-minimal` needs only
Node. If Docker is missing, the CLI tells you before it writes any files.

You don't need pnpm. `npx` comes with Node, and `--pm npm` keeps the generated
project on npm as well.

## Step by step

**1. Scaffold.**

```bash
npx battlestack@latest my-app
```

It asks which template and which optional features you want, then writes the
project and installs dependencies. This takes a few minutes, mostly for the
install.

To skip the questions, name the template and pass `--yes`:

```bash
npx battlestack@latest my-app nuxt4-fullstack --yes
```

**2. Start it.**

```bash
cd my-app
battlestack dev
```

On a template with a database, this also starts Postgres and applies the schema
before the dev server starts. A fresh project needs no separate migrate step.

**3. Log in.** Templates with auth create a seeded admin user. To sign in as
that user:

```bash
battlestack login
```

This opens your browser already signed in as the admin. It only works in
development and refuses to run against a production host. `battlestack uli` is
a shorter alias.

Keep `battlestack dev` running in one terminal and run `login` in another.

## Which template

| Template | What you get | Needs Docker |
| --- | --- | --- |
| `nuxt4-minimal` | Nuxt 4 + UI v4 + Tailwind v4, i18n, Pinia, a `/api/health` route, production Dockerfile + CI. No database, no auth. | no |
| `nuxt4-fullstack` | Everything in minimal, plus Postgres, Drizzle, custom auth, Mastra and Docker Compose. | yes |
| `nuxt4-ai` | Everything in fullstack, plus Mastra agents and WebSocket streaming chat through an OpenAI-compatible AI gateway (sluis.ai preset). RAG is opt-in. | yes |

Use `nuxt4-minimal` if you just want a well-configured Nuxt app. Use
`nuxt4-fullstack` if you need users and a database. You can always add more
later with `battlestack add <feature>`.

## Features

Templates are bundles of *features*, and `battlestack add` picks from the same
list. Currently available:

- **Auth.** Session auth with argon2id, optional passkeys (WebAuthn), TOTP
  two-factor with secrets encrypted at rest, password recovery, email
  verification, and GitHub/Google OAuth.
- **Data.** Postgres + Drizzle in Docker with `db:push`, `seed`, `studio` and
  `shell` commands. Optional Redis rate limiting that falls back to Postgres if
  Redis goes down. Object storage (RustFS locally, S3 in production).
- **AI.** Mastra agents behind an OpenAI-compatible AI gateway (sluis.ai preset,
  see below), a WebSocket streaming chat UI, opt-in RAG on pgvector (ingest,
  chunk, embed, query), and agent prompts that admins can edit.
- **App.** Landing page, signed-in dashboard, admin-only user management, an
  append-only security audit log, PWA, i18n (EN + NL), Nuxt UI v4 + Tailwind
  v4, Pinia.
- **Ops.** Production Dockerfile and compose setup, a `/api/health` endpoint
  that checks the database and config, GitHub Actions, pre-commit hooks, Vitest,
  security headers, and a minimum release age for new dependency versions.

For local development, `battlestack gateway:up` runs a shared Traefik proxy so
each project is served at `https://<name>.battlestack.test` with a locally
trusted certificate.

### The AI gateway and sluis.ai

The AI templates don't call model providers directly. All requests go through
one OpenAI-compatible gateway, set by `NUXT_AI_GATEWAY_URL` and
`NUXT_AI_GATEWAY_KEY` in `.env`. The default preset is
[sluis.ai](https://sluis.ai), SevenLab's hosted gateway. It gives you one API
for many models, keeps data in the EU by default, strips personal data from
prompts before they leave and puts it back in the answers, and keeps a
tamper-evident audit log. New accounts get 50,000 free tokens, so a fresh
`nuxt4-ai` project can chat right away.

To use your own setup instead, choose the custom option when scaffolding and
point `NUXT_AI_GATEWAY_URL` at any OpenAI-compatible endpoint. A self-hosted
LiteLLM proxy works.

## Everyday commands

Run these inside the project. `battlestack --help` lists them all, and only
shows commands for the features you installed.

```
battlestack dev          # dev server (starts Postgres if the project has one)
battlestack build        # production build
battlestack test         # vitest
battlestack up           # just the services (Postgres, mail catcher)
battlestack down         # stop them
battlestack login        # browser, signed in as the seed admin (dev only)
battlestack db:studio    # Drizzle Studio
battlestack add <id>     # add an optional feature later
battlestack doctor       # check the project for drift and missing config
battlestack upgrade      # pick up newer feature versions
```

`bstack` is a shorter alias for `battlestack`, so `bstack dev` works too.

## Installing and updating

**Updating the CLI.** A global install can update itself:

```bash
battlestack self-update
```

Under pnpm this respects the minimum release age, so a release published a few
minutes ago is held back for a while. `--force` installs the latest right away.
If you only use `npx battlestack@latest`, there's nothing to update.

**Updating a project.** You can keep pulling changes into a project after you
scaffold it:

```bash
battlestack pull    # re-apply template and config changes, skipping files you edited
battlestack bump    # bump npm dependencies to latest
battlestack sync    # pull + bump + doctor in one go
```

`pull` won't overwrite files you have edited. With `--force` it does, after
saving each one to `.battlestack/pull/<path>.bak`. Run
`battlestack own <path>` to tell `pull` to never touch a file again.

**Cloned an existing battlestack project?** Run `battlestack install`. It writes
`.env`, installs dependencies and applies the database schema.

## Choosing a package manager

`--pm <pnpm|npm|bun>` sets the package manager for the generated project. It
doesn't matter which one you used to run the scaffold:

```bash
npx battlestack@latest my-app --pm npm
```

pnpm is the default. The lockfile, install, production Dockerfile and GitHub
Actions workflow all follow your choice.

The docs it generates don't follow it everywhere yet. Parts of the generated
`README.md` and `AGENTS.md`, and the `.claude/` rules and skills, still say
`pnpm`. With `--pm npm` or `--pm bun`, substitute your package manager.

## Troubleshooting

**`node: command not found`, or `node -v` shows less than 24.** Install Node 24
or newer from [nodejs.org](https://nodejs.org) or your version manager. Node 25
no longer bundles Corepack, so a new machine often has only npm. That's fine:
scaffold with `npx` and use `--pm npm`.

**Docker errors, or Postgres won't start.** Docker has to be running, not just
installed. `docker ps` should print a table, not an error. With Docker Desktop,
the app needs to be open.

**A port is already in use.** Each project picks its ports based on its name,
checks they are free, and saves them to `.env` on the first run, so two
projects can run side by side. If another program holds a port, change the
matching `*_PORT` in `.env` and restart.

**The scaffold stopped partway.** Run the same command again with `--force` to
recreate the directory. Nothing outside that directory is changed.

**Something seems out of sync.** `battlestack doctor` lists where the project
differs from what it expects, including missing config and moved files.

## Ready for AI coding agents

Every project gets an `AGENTS.md` generated from the features you enabled. If
you skip auth, there's no auth section. If you turn on Mastra, the Mastra
conventions are included. `CLAUDE.md` is a one-line pointer to `AGENTS.md`, so
Claude Code and other agents all read the same file.

`.mcp.json` is generated too. It registers MCP servers only for what you turned
on: Nuxt UI when `nuxt-ui` is enabled, Mastra when Mastra is, Playwright when
Playwright is.

The rule files in `.claude/rules/` are different: every project gets the same
set. Each rule declares a glob in its frontmatter, and your agent loads it only
while editing matching files. `drizzle.mdc` covers `server/database/**/*.ts` and
`drizzle.config.ts`; `vue.mdc` covers `*.vue`. So a project without a database
still has `drizzle.mdc` and `postgres.mdc`, but they never load because no
files match.

## Deployment

Every template includes a production Dockerfile. Templates with a database also
include a `docker-compose.yml` with Postgres and the other services you
enabled, a profile-gated `app` service, and `battlestack prod` commands to run
it.

`GET /api/health` checks the database connection and required config, with a
timeout you can set per environment. Schema changes go through Drizzle
migrations that track what has been applied, so running one twice does nothing
the second time.

`.env` is generated from the features you enabled.

## Packages

battlestack is published as six npm packages:

| Package | Version | What it is |
| --- | --- | --- |
| [`battlestack`](https://www.npmjs.com/package/battlestack) | [![npm](https://img.shields.io/npm/v/battlestack?label=)](https://www.npmjs.com/package/battlestack) | The `npx battlestack` entry point. A thin wrapper around `@battlestack/cli`. |
| [`@battlestack/cli`](https://www.npmjs.com/package/@battlestack/cli) | [![npm](https://img.shields.io/npm/v/@battlestack/cli?label=)](https://www.npmjs.com/package/@battlestack/cli) | The CLI engine: arg parsing, plugin loading, command dispatch. |
| [`@battlestack/core`](https://www.npmjs.com/package/@battlestack/core) | [![npm](https://img.shields.io/npm/v/@battlestack/core?label=)](https://www.npmjs.com/package/@battlestack/core) | The plugin SDK: types, registries and the orchestrator that turns enabled features into an execution plan. |
| [`@battlestack/preset-nuxt4`](https://www.npmjs.com/package/@battlestack/preset-nuxt4) | [![npm](https://img.shields.io/npm/v/@battlestack/preset-nuxt4?label=)](https://www.npmjs.com/package/@battlestack/preset-nuxt4) | The Nuxt 4 preset: one framework, three templates and 39 features. It uses the same plugin API a third-party plugin would. |
| [`@battlestack/tui`](https://www.npmjs.com/package/@battlestack/tui) | [![npm](https://img.shields.io/npm/v/@battlestack/tui?label=)](https://www.npmjs.com/package/@battlestack/tui) | Shared terminal UI (prompts, spinners, banner). |
| [`@battlestack/theme`](https://www.npmjs.com/package/@battlestack/theme) | [![npm](https://img.shields.io/npm/v/@battlestack/theme?label=)](https://www.npmjs.com/package/@battlestack/theme) | The Nuxt UI theme generated projects use: light and dark tokens, brand assets and the logo. |

Projects are built up in three layers: **framework → template → feature**. A
template is a list of features. A feature is a versioned unit that adds files,
dependencies, env vars, docs sections and its own CLI commands. Anyone can
write more: a plugin is an npm package built with `defineBattlestackPlugin()`
that registers features, templates, commands or deploy targets. Plugins can be
private and unpublished; the public code doesn't need to know about them.
[`docs/architecture.md`](docs/architecture.md) explains how it all fits
together.

## More

**[Full documentation is in `docs/`](docs/README.md).** Start with
[Requirements](docs/requirements.md) for what to install, then
[Getting started](docs/getting-started.md).

| | |
| --- | --- |
| [Requirements](docs/requirements.md) | What software you need, per OS |
| [Installation](docs/installation.md) | Running it, installing it, updating it |
| [Getting started](docs/getting-started.md) | First project, start to logged in |
| [Templates](docs/templates.md) | The three starting points |
| [Features](docs/features.md) | The full catalog |
| [Command reference](docs/commands.md) | Every command and flag |
| [Configuration](docs/configuration.md) | `.env`, ports, environment variables |
| [Local development](docs/local-development.md) | Gateway, HTTPS, mail, database tooling |
| [Plugins](docs/plugins.md) | Extending battlestack |
| [Keeping a project current](docs/keeping-projects-current.md) | `pull`, drift, ownership |
| [Deployment](docs/deployment.md) | Image, compose, health checks |
| [Troubleshooting](docs/troubleshooting.md) | Symptoms and fixes |

[`docs/architecture.md`](docs/architecture.md) covers how the plugin system and package split fit
together.

`CONTRIBUTING.md` covers local dev setup and what CI checks.

`SECURITY.md` covers how to report a vulnerability, and what is in scope.

## Who built this

battlestack is built and maintained by **SevenLab**. We use it to start our
own projects and the ones we build for clients.

Questions, ideas, or want to work with us? Email
[hello@sevenlab.ai](mailto:hello@sevenlab.ai) or open an issue.
