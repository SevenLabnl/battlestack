# Templates

A template is a curated list of features, not a folder that gets copied. Two
projects scaffolded from the same template a month apart are assembled from the
feature versions current at each moment, and each records what it used.

Every template splits its features into two groups:

- **Required features** always come with the template.
- **Optional features** are offered at scaffold time, some of them switched on
  by default.

Nothing you skip is lost forever. `battlestack add <feature>` picks from the same
catalog afterwards.

## Choosing

| Template | Gets you | Needs Docker |
| --- | --- | --- |
| `nuxt4-minimal` | Nuxt 4 + Nuxt UI v4 + Tailwind v4, i18n, Pinia, a real `/api/health`, production Dockerfile and CI. No database, no auth. | No |
| `nuxt4-fullstack` | The above plus Postgres, Drizzle, session auth, Mastra and Docker Compose. | Yes |
| `nuxt4-ai` | Full stack plus Mastra agents and streaming chat behind an OpenAI-compatible AI gateway. RAG on by default. | Yes |

Pick `nuxt4-minimal` if you want a well-configured Nuxt app and will add the
backend later. Pick `nuxt4-fullstack` if you already know the product has users
and data. Pick `nuxt4-ai` if agents are the product rather than a feature.

To see the live list on your installed version:

```bash
battlestack templates
```

## nuxt4-minimal

**Nuxt 4 + UI v4 + Tailwind v4 only. No backend, no auth.**

Needs nothing but Node. No containers, no database, no ports beyond the dev
server.

What is always included: the Nuxt scaffold, ESLint and formatting, the
supply-chain release-age policy, Nuxt essentials (fonts, image, iconify,
datepicker, nodemailer), Nuxt UI v4 with Tailwind v4, i18n (English and Dutch),
Pinia with persisted state, Vitest, the `/api/health` endpoint, security headers,
a production Dockerfile, GitHub Actions, AI tool config, the generated docs,
`.env` and the project manifest.

Offered as optional, all four on by default: the landing shell, PWA, git hooks
(lefthook pre-commit), and Playwright.

## nuxt4-fullstack

**Nuxt + UI + i18n + Postgres + Drizzle + custom auth + Mastra + Docker.**

Everything in minimal, plus these as required features: Postgres with Drizzle
running in Docker, session-based auth with argon2id, the authenticated
`/dashboard/*` shell, and the Mastra AI runtime.

Optional, on by default: the audit log, admin-gated user administration,
password recovery, TOTP two-factor, passkeys, object storage, PWA, git hooks and
Playwright.

Optional, off by default:

| Feature | Why it is off |
| --- | --- |
| `nuxt4:oauth` | Needs GitHub or Google OAuth apps registered before it does anything. |
| `nuxt4:chat` | Streaming chat is the point of `nuxt4-ai`, not of a general full-stack app. |
| `nuxt4:redis` | Postgres alone is already correct for rate limiting. Redis is headroom, not a fix. |
| `nuxt4:rag` | Meaningful only once you have documents to ingest. |
| `nuxt4:prompts` | Admin-editable prompts matter once agents are central. |

## nuxt4-ai

**Full stack + Mastra agents + streaming chat + Docker. RAG opt-in.**

Everything in fullstack's required set, plus streaming chat as a required
feature.

Optional and on by default: RAG on pgvector and admin-editable prompt
management, alongside the same auth extras, storage, PWA, git hooks and
Playwright that fullstack defaults on.

Optional and off by default: OAuth and Redis.

The AI features talk to one OpenAI-compatible AI gateway rather than to model
providers directly. See [Configuration](configuration.md#ai-gateway) for the two
variables involved and how to point them at your own infrastructure.

## Selecting features non-interactively

Both flags take a comma-separated list of feature ids and work at scaffold time:

```bash
# Turn optional features on regardless of the template default
npx battlestack@latest my-app nuxt4-fullstack --features nuxt4:oauth,nuxt4:redis --yes

# Turn defaults off
npx battlestack@latest my-app nuxt4-ai --disable nuxt4:storage,nuxt4:rag --yes
```

A feature id is namespaced: `nuxt4:*` for Nuxt-specific features, `shared:*` for
ones that are not tied to the framework. [Features](features.md) lists them all.

## What a template cannot do

A template only chooses features, so it cannot change how a feature behaves.
That keeps the two levels honest: a bug fixed in `nuxt4:auth` reaches every
template and, through `battlestack pull`, every project already scaffolded from
one.

It also means new templates are cheap. A plugin can register its own template
from the same catalog, or extend an existing one, using the same public plugin
API the Nuxt preset uses. See [architecture.md](architecture.md).
