# Deployment

Every template ships a production Dockerfile. The templates with a database also
ship a compose setup wiring up Postgres and whichever services you enabled, plus
commands to drive it.

battlestack does not deploy for you. It gives you an image that behaves like a
production image and a health endpoint worth probing, and leaves the choice of
platform to you. A plugin can add a deploy target if you want that wired in; see
[Plugins](plugins.md).

## The image

`Dockerfile` is a multi-stage build. The build stage installs dependencies and
compiles the Nitro server; the runtime stage ships only `.output/` and runs as
the unprivileged `node` user on port 3000.

Two consequences worth knowing:

- The runtime image carries no build toolchain and no `node_modules` beyond what
  Nitro bundled, so it is small and has less to attack.
- It does not run as root. If you mount volumes into it, the permissions have to
  suit an unprivileged user.

The Dockerfile is correct for whichever package manager you scaffolded with, so
`--pm npm` does not leave you with a pnpm-shaped image.

## Running the production stack locally

The compose file has a **profile-gated `app` service**. It only activates under
`--profile prod`, which is why `battlestack dev` and `battlestack up` ignore it
and start only the services.

```bash
battlestack prod         # build the image and start the stack
battlestack prod:logs    # tail the app logs
battlestack prod:ps      # stack status
battlestack prod:down    # stop it
```

```bash
battlestack prod:build   # build the image without running it
battlestack prod:up      # start without rebuilding
```

This runs the real image against a real Postgres on your machine, which catches
the class of bug that only appears in a production build: a dependency that was
only ever a dev dependency, an env var read at build time, a route that worked
under Vite and not under Nitro.

Run it before you ship, not after.

## Build-time secrets

Some features need a credential during the build rather than at runtime, for
example to install from a private registry. Those are passed as Docker BuildKit
build secrets rather than as build arguments, so they do not persist in an image
layer. `battlestack prod` forwards them from your environment, and the generated
project's `README.md` names the ones your feature set actually needs.

## Health checks

```
GET /api/health
```

Returns `{ status, version, checks }`, and it means something:

- **200** when healthy.
- **503** when degraded, provided `health.failOnDegraded` is on, which it is by
  default.
- The database ping is bounded by `health.dbTimeoutMs`, default 1000ms, so a hung
  database fails the probe instead of hanging it.

Override per environment:

```
NUXT_HEALTH_FAIL_ON_DEGRADED=
NUXT_HEALTH_DB_TIMEOUT_MS=
```

Point both your liveness and readiness probes at this route. It is a real check
rather than a static 200, which is the entire reason it is worth probing.

Without a database, the endpoint still checks required configuration, so a
container missing a critical env var reports unhealthy rather than serving broken
pages.

## Schema changes in production

Use migrations, not `db:push`:

```bash
battlestack db:generate    # in development, commit the result
battlestack db:migrate     # in the target environment
```

Migrations track what has already been applied, so re-running one is a no-op
rather than a second attempt at the same change. That is what makes it safe for
a deploy pipeline to run migrations unconditionally.

Where several replicas start at once, the migrator takes a database-level
advisory lock, so exactly one applies a given migration and the others wait
rather than racing.

`db:push` skips migration files entirely. It is right while iterating on a schema
nobody else has and wrong for anything deployed.

## Environment for production

`.env` is a development file, and it is gitignored. In production, supply the
same keys through your platform's secret mechanism.

Things to get right:

| Key | Why |
| --- | --- |
| `NUXT_SESSION_PASSWORD` | Must be a real secret, at least 32 characters, and different from development. Rotating it invalidates every session. |
| `NUXT_DATABASE_URL` | Your production database, not a container. |
| `NUXT_PUBLIC_APP_URL` | Your real public URL. Wrong here breaks OAuth callbacks and passkeys. |
| `NUXT_WEBAUTHN_RP_ID` | Must match your production domain, or passkeys silently fail. |
| `NUXT_AI_GATEWAY_KEY` | A production key, with its own budget. |
| `NUXT_S3_*` | A real S3-compatible provider, not the local object store. |

`.env.example` is committed and lists every key your feature set uses, which
makes it the checklist for setting up a new environment.

`battlestack doctor` reports missing required configuration, and the app itself
guards the session secret at boot in production rather than starting with an
insecure default.

## CI

`shared:github` emits GitHub Actions workflows, correct for your package
manager. They are a quality gate: install, type-check, test, build.

The workflows are ordinary files in your repository. Edit them freely, and if you
edit them heavily, `battlestack own .github/workflows/<file>` stops `pull`
offering updates to them. See
[Keeping a project current](keeping-projects-current.md).

## A pre-deploy checklist

```bash
battlestack doctor        # config and drift
battlestack test          # the suite
battlestack build         # it builds
battlestack prod          # the real image runs against a real database
```

Then check `/api/health` on the running container returns 200, and confirm your
production environment has every key from `.env.example`.
