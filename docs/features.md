# Features

A feature is the unit battlestack actually builds with. It is versioned, and it
contributes some combination of files, dependencies, environment variables,
documentation sections and its own CLI subcommands. Templates are curated lists
of features, and `battlestack add` picks from the same catalog.

Feature ids are namespaced. `nuxt4:*` features are specific to the Nuxt
framework; `shared:*` features are not tied to it.

To see the catalog as your installed version has it:

```bash
battlestack features
```

## Adding and removing

Run these inside a project:

```bash
battlestack add nuxt4:oauth
battlestack remove nuxt4:redis
```

`add` runs the feature the same way the scaffold would: it writes its files,
adds its dependencies, extends `.env`, and its commands appear in
`battlestack --help` from then on. Some features require others, and `add`
pulls those in rather than failing.

A feature is only addable if the project's framework supports it. Adding
something meaningless for your template is refused rather than half-applied.

## Auth

Session auth, and the pieces that build on it.

| Feature | What it gives you |
| --- | --- |
| `nuxt4:auth` | Session-based authentication with argon2id password hashing. The foundation the rest of this table requires. |
| `nuxt4:auth-verification` | Email verification on signup. |
| `nuxt4:auth-recovery` | Forgot-password and reset flows, with one-time hashed tokens. |
| `nuxt4:auth-2fa` | Authenticator-app two-factor over TOTP. Secrets are encrypted at rest. |
| `nuxt4:auth-passkeys` | Passwordless login and registration via platform passkeys (WebAuthn). |
| `nuxt4:oauth` | Social sign-in through GitHub and Google. Off by default, because it needs OAuth apps registered first. |
| `nuxt4:user-admin` | Admin-only `/dashboard/users` for listing, creating, editing and deleting users. |

`nuxt4:auth` also contributes `battlestack login` (alias `uli`), which opens a
browser signed in as the seeded admin. It is dev-only and refuses to run against
a production host.

## Data

| Feature | What it gives you |
| --- | --- |
| `nuxt4:database` | PostgreSQL with Drizzle ORM, running in Docker, plus the `db:*` command family. |
| `nuxt4:storage` | File uploads and presigned downloads. RustFS locally, an S3-compatible provider in production. |
| `nuxt4:redis` | Runs the rate limiter on Redis: compose service, client, policies, and a circuit breaker that fails over to Postgres automatically. |
| `nuxt4:audit-log` | Append-only trail of login, signup, role change and passkey events. |

`nuxt4:redis` is offered but off by default, and the reason is worth stating
plainly: Postgres alone is already correct across replicas for rate limiting.
Redis buys headroom under concentrated floods. It is not a correctness fix, so
you do not need it to be safe.

## AI

| Feature | What it gives you |
| --- | --- |
| `nuxt4:mastra` | The Mastra AI runtime: agents, tools, and the server wiring around them. |
| `nuxt4:chat` | Streaming chat UI at `/chat`, backed by Mastra's `default` agent, exposed through a `useChatAgent()` composable. |
| `nuxt4:rag` | Retrieval over pgvector: ingest, chunk, embed and query documents through Mastra. |
| `nuxt4:prompts` | Admin-editable agent prompts, with the shipped registry as defaults. |

Everything here talks to one OpenAI-compatible AI gateway rather than to model
providers directly. See [Configuration](configuration.md#ai-gateway).

**A note on the chat transport.** Chat ships two transports and the default is
`ws-nitro`, a Nitro WebSocket handler at `/_ws`. The alternative, `http`
(chunked streaming), is shipped but **not production-ready today**, because edge
platforms buffer it. It is manual opt-in only and never selected for you. The
transport is fixed at scaffold time and recorded in the manifest; changing it
means re-running `battlestack pull` with a new value.

To change the agent itself, edit `server/mastra/agents/default.ts`. That is where
the system prompt, model and tools live.

## App surface

| Feature | What it gives you |
| --- | --- |
| `nuxt4:nuxt-ui` | Nuxt UI v4 on Tailwind v4. |
| `nuxt4:landing-shell` | Public landing page, layouts, and the frontend app shell. |
| `nuxt4:dashboard-shell` | The authenticated application shell at `/dashboard/*`. |
| `nuxt4:i18n` | Internationalisation, with English and Dutch. |
| `nuxt4:pinia` | Pinia with persisted state. |
| `nuxt4:pwa` | Installable, offline-capable app via `@vite-pwa/nuxt`. |

## Ops and quality

| Feature | What it gives you |
| --- | --- |
| `nuxt4:health` | A real `/api/health`: database ping plus required-config checks, bounded by a timeout. |
| `nuxt4:vitest` | Vitest configuration and scripts. |
| `shared:playwright` | Playwright MCP for AI browser testing, plus test utilities. |
| `shared:ci` | Pre-commit ESLint on staged files, via lefthook. |
| `shared:github` | GitHub Actions workflows. |
| `shared:docker` | Production Dockerfile plus the `prod:*` command family. |
| `shared:security` | Security headers, via nuxt-security. |
| `shared:package-policy` | Supply-chain release-age policy for dependencies, with `policy:status` and `policy:tick`. |
| `shared:ai-tool-config` | Generated AI coding-tool config: `AGENTS.md`, `CLAUDE.md`, `.mcp.json`, `.claude/rules/`. |

`shared:package-policy` deserves a word. A dependency published minutes ago is
the one most likely to be compromised, so the policy holds brand-new releases
back for a short window and ramps in. `battlestack policy:status` shows where a
project sits.

## Plumbing

These are always present and you rarely think about them. They are listed so the
catalog is complete and so `battlestack doctor` output makes sense.

| Feature | What it does |
| --- | --- |
| `nuxt4:scaffold` | Creates the Nuxt project itself. |
| `nuxt4:naming` | Sets `package.json#name`. |
| `nuxt4:gitignore` | Enforces ignore patterns for git, Nuxt and ESLint. |
| `nuxt4:essentials` | Nuxt essentials: ESLint, fonts, image, iconify, datepicker, nodemailer. |
| `nuxt4:docs` | Generates `README.md`, `AGENTS.md` and `CLAUDE.md` from the enabled features. |
| `nuxt4:finalize` | Writes the project manifest. |
| `shared:formatting` | Formatting config and `.dockerignore`. |
| `shared:env` | Writes `.env` and `.env.example` from the enabled features. |
| `shared:install` | Assembles `package.json` and runs the dependency install. |

## Feature versions, and why they matter to you

Every feature carries a semver version, and it is unrelated to the CLI's release
number. Your project's manifest records which feature versions produced which
files.

That record is what makes `battlestack pull` possible. When a feature's version
has moved on since your project was created, `pull` knows there is an update to
apply; when it has not, the feature is reported up to date and skipped. It is
the difference between a starter kit and a maintained one.

See [Keeping a project current](keeping-projects-current.md).
