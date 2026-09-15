# Requirements

battlestack asks for very little. One hard requirement, one conditional
requirement, and a short list of things that unlock extras.

Before it writes anything, the CLI runs a preflight check and prints the result
as a list. If something required is missing it stops there, so you never get a
half-written project because Docker was not running.

## The short version

| Software | Needed for | Required? |
| --- | --- | --- |
| [Node.js](https://nodejs.org) 24 or newer | Everything. | Yes, always |
| A package manager: pnpm, npm or bun | Installing the generated project's dependencies. | Yes, one of them |
| [Docker](#docker) | Templates with a database (`nuxt4-fullstack`, `nuxt4-ai`). | Only for those templates |
| [Git](#git) | Version control, and `battlestack install` after cloning. | Strongly recommended |
| [mkcert](#mkcert-optional) | `https://<project>.battlestack.test` hostnames with locally-trusted TLS. | Optional |

Nothing else. No global framework CLI, no language runtime besides Node, no
database installed on your machine: Postgres, Redis, the mail catcher and the
object store all run in containers that battlestack manages for you.

## Node.js

**Node 24 is the minimum.** Check what you have:

```bash
node -v
```

If that prints below `v24`, install a newer Node from
[nodejs.org](https://nodejs.org) or through a version manager
([fnm](https://github.com/Schniz/fnm), [nvm](https://github.com/nvm-sh/nvm),
[Volta](https://volta.sh), [mise](https://mise.jdx.dev)). A version manager is
the better choice if you work on other projects that pin older Node versions.

Node ships `npx`, which is all you need to run battlestack. There is no separate
install step to scaffold a project.

## Package manager

The generated project needs a package manager to install its dependencies. Pick
with `--pm`; pnpm is the default.

| Package manager | Supported | Notes |
| --- | --- | --- |
| **pnpm** | Yes, and it is the default, 11.3 or newer | What battlestack itself is developed and tested against. |
| **npm** | Yes | Comes with Node, so it is already there. Use `--pm npm`. |
| **bun** | Yes | Use `--pm bun`. See the verified matrix in [CONTRIBUTING.md](../CONTRIBUTING.md). |
| **yarn** | **No** | Some of the emitted scaffolding breaks under yarn classic. Do not use it. |

You do not need pnpm installed to *scaffold*. `npx battlestack@latest` runs
through the Node that is already on your machine. You need pnpm only if the
generated project is going to use pnpm, which is the default:

```bash
npm i -g pnpm
```

pnpm 11.3 or newer is required. Preflight fails on anything older, before the
scaffold starts, rather than part-way through the install. Above that floor but
below the version battlestack is tested against, preflight prints a warning
rather than failing, and suggests `pnpm self-update`. The blocking row points at
`npm i -g` and at `--pm npm` instead, since neither needs the old pnpm to work.
[Troubleshooting](troubleshooting.md) covers why the floor sits at 11.3.

Node 25 dropped bundled Corepack, so a freshly installed Node often has npm and
nothing else. That is fine: scaffold with `npx` and pass `--pm npm`.

See [Configuration](configuration.md#package-manager) for what `--pm` does and
does not change.

## Docker

Docker is needed for the templates that run a database, which is
`nuxt4-fullstack` and `nuxt4-ai`. `nuxt4-minimal` needs nothing but Node.

Either of these works:

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) on macOS,
  Windows or Linux.
- [OrbStack](https://orbstack.dev) on macOS, which is lighter and faster.
- On Linux, Docker Engine plus the Compose plugin is fine too.

**Installed is not enough. It has to be running.** Preflight checks two things
separately: that the `docker` binary is on your PATH, and that the daemon
actually answers. Verify both yourself with:

```bash
docker ps
```

That should print a table, even an empty one. An error means the daemon is not
up: open Docker Desktop or start OrbStack and try again.

What runs in containers, depending on the features you enable: Postgres,
[Mailpit](https://mailpit.axllent.org) for catching outgoing mail,
[RustFS](https://rustfs.com) as a local S3-compatible object store, Redis, and
the Traefik gateway. You never install any of those yourself.

## Git

Git is not required to scaffold a project, and preflight treats a missing `git`
as a warning rather than a failure. In practice you want it:

- The scaffold writes a `.gitignore` tuned to what it generated, which is only
  useful inside a repository.
- `battlestack install` is the post-clone bootstrap for a project that someone
  else scaffolded, and cloning needs Git.
- The generated GitHub Actions workflows assume a Git remote.

Install it from [git-scm.com](https://git-scm.com), or with
`brew install git`, `winget install Git.Git`, or your distribution's package
manager.

## mkcert (optional)

[mkcert](https://github.com/FiloSottile/mkcert) issues certificates that your
own machine trusts. With it installed, `battlestack gateway:up` runs a shared
Traefik proxy and every project is reachable at
`https://<project>.battlestack.test` with real TLS and no browser warning.

Without it, nothing breaks: `battlestack dev` falls back to a plain localhost
port, and the gateway step is skipped with a note telling you why.

```bash
brew install mkcert nss          # macOS
choco install mkcert             # Windows (or: scoop install mkcert)
```

On Linux, follow the
[mkcert Linux instructions](https://github.com/FiloSottile/mkcert#linux).

The first gateway run calls `mkcert -install` once to add the local certificate
authority to your trust store, then records that it did so and does not repeat
it.

## Operating systems

| Host | Scaffold and develop | HTTPS gateway hostnames |
| --- | --- | --- |
| **macOS** | Yes | Yes, including the automatic hosts-file entry. |
| **Windows** (native) | Yes | Yes, including the automatic hosts-file entry (it asks for elevation). |
| **Linux** | Yes | TLS works; the hosts-file entry is not written for you, so add `<project>.battlestack.test` to `/etc/hosts` yourself. |
| **WSL2** | Yes | Not available. Use the localhost port that `battlestack dev` prints. |

Windows is a supported target rather than an assumed one: CI type-checks, tests,
builds and then scaffolds a real `nuxt4-fullstack` project on native Windows and
asserts on the result.

## Checking a machine

Inside a scaffolded project, `battlestack doctor` re-runs these checks against
your current environment and reports what it finds, alongside project drift:

```bash
battlestack doctor
```

It is read-only, so it is always safe to run.

## What about the AI templates

`nuxt4-ai` needs no extra software. It talks to one OpenAI-compatible AI
gateway over HTTPS, configured by two variables in `.env`. You need credentials
for a gateway, not a local model runtime. See
[Configuration](configuration.md#ai-gateway).
