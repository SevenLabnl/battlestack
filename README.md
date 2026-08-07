# battlestack

A scaffolding CLI for Nuxt 4. Answer a few prompts and it hands you a running
app, not a folder of TODOs you still have to wire together.

```bash
npx battlestack@latest my-app
cd my-app
battlestack dev
```

Then open the URL it prints. That is the whole happy path.

## Before you start

**Node 24 or newer** is the only hard requirement. Check with `node -v`.

**Docker** is needed only for the templates with a database (`nuxt4-fullstack`
and `nuxt4-ai`), which run Postgres in a container. `nuxt4-minimal` needs
nothing but Node. If Docker is missing, the CLI tells you before it writes
anything rather than failing halfway through.

You do **not** need pnpm installed. `npx` ships with Node, and `--pm npm` keeps
the generated project on npm too.

## Step by step

**1. Scaffold.**

```bash
npx battlestack@latest my-app
```

It asks which template you want and which optional features to include, then
writes the project and installs its dependencies. Expect a few minutes: most of
it is the dependency install, not us.

To skip the questions, name the template and pass `--yes`:

```bash
npx battlestack@latest my-app nuxt4-fullstack --yes
```

**2. Start it.**

```bash
cd my-app
battlestack dev
```

On a template with a database this also starts Postgres and applies the schema
before the dev server comes up, so there is no separate migrate step on a fresh
project.

**3. Log in.** Templates with auth seed an admin user. Rather than hunting for
its password:

```bash
battlestack login
```

That opens your browser already signed in as the seed admin. It is dev-only and
refuses to work against a production host. `battlestack uli` is a shorter alias.

Leave `battlestack dev` running in one terminal and use another for `login`.

## Which template

| Template | Gets you | Needs Docker |
| --- | --- | --- |
| `nuxt4-minimal` | Nuxt 4 + UI v4 + Tailwind v4, i18n, Pinia, a `/api/health` route, production Dockerfile + CI. No database, no auth. | no |
| `nuxt4-fullstack` | The above plus Postgres, Drizzle, custom auth, Mastra and Docker Compose. | yes |
| `nuxt4-ai` | Full stack plus Mastra agents and HTTP streaming chat. RAG opt-in. | yes |

Start with `nuxt4-minimal` if you only want a well-configured Nuxt app. Pick
`nuxt4-fullstack` if you know you need users and a database. Nothing is a dead
end: `battlestack add <feature>` pulls in more later.

## Everyday commands

Run these inside the project. `battlestack --help` lists all of them, and the
list reflects what you actually installed.

```
battlestack dev          # dev server (starts Postgres if the project has one)
battlestack build        # production build
battlestack test         # vitest
battlestack up           # just the services (Postgres, mail catcher)
battlestack down         # stop them
battlestack login        # browser, signed in as the seed admin (dev only)
battlestack db:studio    # Drizzle Studio
battlestack add <id>     # add an optional feature after the fact
battlestack doctor       # check the project for drift and missing config
battlestack upgrade      # pick up newer feature versions
```

**`bstack` is a shorter alias for `battlestack`.** Same binary, either name, so
`bstack dev` works too.

## Choosing a package manager

`--pm <pnpm|npm|bun>` sets the package manager for the *generated* project,
independent of whichever one ran the scaffold:

```bash
npx battlestack@latest my-app --pm npm
```

pnpm is the default. `--pm` is honoured everywhere it is load-bearing for
*running* the project: the lockfile, the install, the production Dockerfile and
the emitted GitHub Actions workflow are all correct for whichever you pick.

It is not yet honoured everywhere it is load-bearing for *instructing* a human
or an agent. Parts of the generated `README.md` and `AGENTS.md`, and the
`.claude/` rules and skills, still spell their commands `pnpm`. Under
`--pm npm` or `--pm bun`, read those as "your package manager".

## When something goes wrong

**`node: command not found`, or `node -v` prints below 24.** Install Node 24+
from [nodejs.org](https://nodejs.org) or your version manager. Node 25 dropped
bundled Corepack, so a fresh machine often has npm and nothing else. That is
fine: use `npx` to scaffold and `--pm npm` for the project.

**A Docker error, or Postgres will not start.** Docker needs to be installed
*and running*, not just installed. `docker ps` should print a table rather than
an error. On Docker Desktop, that means the app is open.

**A port is already in use.** Each project derives its ports from its name,
probes them, and freezes the working set into `.env` on first run, so two
scaffolds can run side by side. If something outside battlestack holds a port,
edit the relevant `*_PORT` in `.env` and restart.

**The scaffold stopped partway.** Re-run the same command with `--force` to
recreate the directory from scratch. Nothing outside that directory is touched.

**Something feels out of sync.** `battlestack doctor` reports drift between the
project and what it expects, including missing config and files that have moved.

## Built for an AI to pick up on day one

Every scaffold writes `AGENTS.md`, generated from the features you actually
enabled rather than copied from a static template. Skip auth and there is no
auth section; turn on Mastra and the agent-specific conventions appear.
`CLAUDE.md` is a one-line pointer at it, so Claude Code and anything else
reading `AGENTS.md` see one source instead of two docs drifting apart.

`.mcp.json` is generated too: it registers MCP servers for exactly what you
turned on, Nuxt UI when `nuxt-ui` is on, Mastra when Mastra is, Playwright when
Playwright is, and nothing else.

Rule files in `.claude/rules/` work the other way round. They are a fixed set,
copied verbatim, each scoped by a glob its own frontmatter declares, so your
agent loads a rule only while editing files that match. `drizzle.mdc` covers
`server/database/**/*.ts` and `drizzle.config.ts`; `vue.mdc` covers `*.vue`.
Because the set is fixed, a template without a database still gets
`drizzle.mdc` and `postgres.mdc` on disk: inert, since nothing matches their
globs, but present.

## Shaped for deployment, not just a demo

Every template ships a production Dockerfile. The templates with a database also
ship a `docker-compose.yml` wiring up Postgres and whichever other services you
enabled, plus a profile-gated `app` service and `battlestack prod` commands to
drive it.

`GET /api/health` returns a real status: a database ping and required-config
checks, bounded by a timeout and configurable per environment, so a container
orchestrator can probe it rather than reading a static 200. Schema changes go
through Drizzle migrations that track what is already applied, so re-running one
is a no-op instead of a second attempt at the same change.

`.env` is generated from the features you enabled, not a template with
placeholders left in it for you to find later.

## More

`ARCHITECTURE.md` covers how the plugin system and package split fit together.

`CONTRIBUTING.md` covers local dev setup and what CI checks.
