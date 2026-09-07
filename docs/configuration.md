# Configuration

A generated project is configured through three files, plus the manifest that
battlestack maintains for itself.

| File | Owns | Committed? |
| --- | --- | --- |
| `.env` | Secrets, ports, connection strings. | No, and it is gitignored. |
| `.env.example` | The same keys with placeholder values, as documentation. | Yes. |
| `nuxt.config.ts` | Everything Nuxt. | Yes. |
| the project manifest | Which feature versions produced which files. | Yes. |

## .env is generated, not templated

`.env` is assembled from the features you enabled, so it contains the keys your
project actually uses and nothing else. Skip auth and there are no session or
SMTP keys to wonder about.

Each feature declares its own variables, and one owner writes the file. That is
why you never get a placeholder for something you did not turn on.

Three kinds of value end up there:

- **Generated secrets.** Things battlestack owns, like the session password, are
  generated with real entropy per project. You never invent them, and a
  leftover `change-me` placeholder in an existing `.env` is upgraded to a real
  value on the next run.
- **Frozen ports.** Derived from the project name, probed for availability, then
  written down so they stay stable across runs. See [Ports](#ports).
- **External credentials.** Things only you can supply, like OAuth client
  secrets and the AI gateway key. These arrive as blanks for you to fill in.

`battlestack pull` adds keys that new features introduced, and never overwrites
a value you have set. Where your value differs from the recommended one, it
tells you rather than changing it.

`battlestack doctor` reports missing required configuration.

## Ports

Two battlestack projects can run at the same time without colliding, and this is
the mechanism.

Each project derives a port per service from a hash of its name, so the numbers
are stable and different per project. On first run the CLI probes them, and
freezes the working set into `.env`. From then on `.env` is the source of truth.

Every port is a `1` prefixed to the service's conventional default, which makes
them easy to recognise:

| Service | Range | Derived from | `.env` key |
| --- | --- | --- | --- |
| App (Nuxt) | 13000+ | 3000 | `NUXT_PORT` |
| Postgres | 15432+ | 5432 | `DB_PORT` |
| Mail, SMTP | 11025+ | 1025 | `SMTP_PORT` |
| Mail, web UI | 18025+ | 8025 | `MAIL_UI_PORT` |
| Object storage API | 19000+ | 9000 | `S3_API_PORT` |
| Object storage console | 19500+ | (moved up to avoid overlap) | `S3_CONSOLE_PORT` |
| Mastra Studio | 14111+ | 4111 | none, passed per run |
| Redis | 16500+ | (not default-derived) | `REDIS_PORT` |

To see what a project is actually using:

```bash
battlestack describe
```

**To change a port**, edit the relevant `*_PORT` in `.env` and restart. Nothing
recomputes it behind your back once it is frozen.

If something outside battlestack holds a port at startup, preflight warns rather
than failing, and names what is holding it where it can tell.

## Package manager

`--pm <pnpm|npm|bun>` sets the package manager for the *generated project*,
independent of whatever ran the scaffold:

```bash
npx battlestack@latest my-app --pm npm
```

pnpm is the default. Where `--pm` is load-bearing for *running* the project it
is honoured everywhere: the lockfile, the install, the production Dockerfile and
the emitted GitHub Actions workflow are all correct for whichever you pick.

Where it is load-bearing for *instructing a human or an agent*, it is not fully
honoured yet. Parts of the generated `README.md` and `AGENTS.md`, and the
`.claude/` rules and skills, still spell their commands `pnpm`. Under
`--pm npm` or `--pm bun`, read those as "your package manager".

yarn is not supported. Some of the emitted scaffolding breaks under yarn classic.

## AI gateway

The AI features never talk to model providers directly. Everything goes through
one OpenAI-compatible gateway, configured by two variables:

```
NUXT_AI_GATEWAY_URL=
NUXT_AI_GATEWAY_KEY=
```

Plus optional model selection:

```
NUXT_AI_GATEWAY_CHAT_MODEL=
NUXT_AI_GATEWAY_EMBEDDING_MODEL=
NUXT_AI_GATEWAY_HEADERS=
```

The built-in preset is [sluis.ai](https://sluis.ai), SevenLab's hosted AI
gateway: one API for every model, EU data residency by default, PII stripped
from prompts before they leave and restored in the answers, and a tamper-evident
audit ledger. New accounts start with 50,000 free tokens, so a fresh `nuxt4-ai`
scaffold can hold a conversation before you have configured anything else.

Prefer your own infrastructure? Choose the custom option at scaffold time and
point `NUXT_AI_GATEWAY_URL` at any OpenAI-compatible endpoint. A self-hosted
LiteLLM proxy works, as does OpenAI itself or a vendor's own compatible
endpoint. Nothing about the generated code is specific to the preset.

## Variables by feature

Only the variables for features you enabled appear in your `.env`.

### Core

| Key | Notes |
| --- | --- |
| `NUXT_PORT` | Frozen app port. |
| `NUXT_PUBLIC_APP_URL` | Public base URL of the app. |
| `NUXT_ALLOWED_ORIGINS` | Accepted origins. |

### Database, from `nuxt4:database`

| Key | Notes |
| --- | --- |
| `NUXT_DATABASE_URL` | Postgres connection string. |
| `DB_NAME`, `DB_PORT` | Used by the compose service and the URL above. |

### Auth, from `nuxt4:auth` and its extras

| Key | Notes |
| --- | --- |
| `NUXT_SESSION_PASSWORD` | Generated. Seals session cookies. Must be at least 32 characters, and the CLI refuses a shorter one. |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | The seeded admin that `battlestack login` signs you in as. |
| `NUXT_SMTP_HOST`, `NUXT_SMTP_PORT`, `NUXT_SMTP_USERNAME`, `NUXT_SMTP_PASSWORD`, `NUXT_SMTP_FROM` | Outgoing mail. Locally these point at the mail catcher. |
| `NUXT_PUBLIC_REQUIRE_EMAIL_VERIFICATION` | Whether signup requires verification. |
| `NUXT_TOTP_ENCRYPTION_KEY`, `NUXT_TOTP_STRICT` | Two-factor. Secrets are encrypted at rest with this key. |
| `NUXT_WEBAUTHN_RP_ID`, `NUXT_WEBAUTHN_RP_NAME` | Passkey relying-party identity. |
| `OAUTH_GITHUB_CLIENT_ID`, `OAUTH_GITHUB_CLIENT_SECRET` | From your GitHub OAuth app. |
| `OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_SECRET` | From your Google OAuth client. |

### Storage, from `nuxt4:storage`

| Key | Notes |
| --- | --- |
| `NUXT_S3_ENDPOINT`, `NUXT_S3_REGION`, `NUXT_S3_BUCKET` | Local RustFS in development, your provider in production. |
| `NUXT_S3_ACCESS_KEY_ID`, `NUXT_S3_SECRET_ACCESS_KEY` | Credentials. |
| `NUXT_S3_PUBLIC_BASE_URL` | Base URL for public objects. |
| `S3_API_PORT`, `S3_CONSOLE_PORT` | Frozen local ports. |

### Rate limiting, from `nuxt4:redis`

| Key | Notes |
| --- | --- |
| `NUXT_REDIS_URL`, `REDIS_PORT` | Redis connection. |
| `NUXT_RATE_LIMIT_DISABLED` | Escape hatch for local work. |

### RAG, from `nuxt4:rag`

| Key | Notes |
| --- | --- |
| `NUXT_RAG_EMBEDDING_DIMENSIONS` | Must match the embedding model. Changing it means re-embedding. |
| `NUXT_RAG_MAX_CHUNK_SIZE`, `NUXT_RAG_CHUNK_OVERLAP` | Chunking. |
| `NUXT_RAG_TOP_K` | Retrieved chunks per query. |

### Testing, from `shared:playwright`

| Key | Notes |
| --- | --- |
| `PLAYWRIGHT_TEST_EMAIL`, `PLAYWRIGHT_TEST_PASSWORD` | Credentials the end-to-end tests log in with. |

## Health checks

`GET /api/health` returns a real status rather than a static 200: a database ping
plus required-configuration checks, bounded by a timeout and configurable per
environment. It is meant to be probed by a container orchestrator. See
[Deployment](deployment.md).

## The manifest

The manifest is battlestack's own record: which features are enabled, which
versions produced which files, content hashes for drift detection, and which
paths you have claimed as yours.

**Commit it.** It is what makes `battlestack pull` and `battlestack doctor` work
for everybody on the team rather than just the person who ran the scaffold.

You do not normally edit it. `battlestack own` and `battlestack disown` are the
supported way to change file ownership. See
[Keeping a project current](keeping-projects-current.md).
