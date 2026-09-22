# Versioning a generated project

How a scaffolded app gets a version number, and how anyone looking at a running
instance can tell which commit it is.

This is about **projects battlestack generates**. For how a battlestack release
itself is cut, see [Releasing](releasing.md).

## The model

| Where | What it holds |
| --- | --- |
| `v<version>` tag | The version. A human creates it by dispatching the Release workflow. |
| the image | `APP_VERSION`, `GIT_SHA`, `BUILD_TIME` and `APP_REPO_URL`, baked in as `NUXT_PUBLIC_APP_*` and as OCI labels. |
| the footer | `Version 1.4.2 · a1b2c3d`, the sha linking to the commit. |
| `GET /api/health` | `{ status, version, commit, builtAt, checks }` — the same values, for monitoring. |

There is no `version` field in `package.json`, on purpose. A version written
into a file has to be committed, which means the release itself is a commit that
then needs deploying, and which means the file and the tag can disagree. The tag
is the only copy.

## Cutting a version

**Actions → Release → Run workflow**, then pick `patch`, `minor` or `major`.

It reads the highest `v*` tag, bumps the part you chose, pushes the new
annotated tag and publishes a GitHub release with generated notes. From `v1.4.1`
a `minor` produces `v1.5.0`.

The number is yours to choose. Nothing bumps it on a merge, and the workflow has
no trigger other than the manual dispatch — the point of owning a version number
is that someone decided what the change was worth calling.

Three things it refuses:

- A commit that already carries a `v*` tag. Two numbers for identical code makes
  a running image untraceable.
- A tag that already exists.
- A latest tag that is not a plain `vMAJOR.MINOR.PATCH`.

It writes no commit and opens no pull request, so it needs no personal access
token and never argues with a protected branch. It also does not deploy: tagging
and shipping are separate decisions.

## What the build does with it

The Dockerfile's **runtime** stage takes four build args:

```bash
docker build \
  --build-arg APP_VERSION="1.4.2" \
  --build-arg GIT_SHA="$(git rev-parse HEAD)" \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg APP_REPO_URL="https://github.com/acme/widgets" \
  -t widgets:1.4.2 .
```

They are declared in the runtime stage rather than the build stage deliberately:
they change on every commit, and an arg the build stage read would invalidate the
dependency install and the Nuxt build every time. Here only the last, tiny layer
is rebuilt.

A deploy pipeline derives the version from the tag rather than being told it:

```bash
version=$(git describe --tags --match 'v[0-9]*' 2>/dev/null || echo "")
version=${version#v}
: "${version:=0.0.0-$(git rev-parse --short HEAD)}"
```

`git describe` needs the tags, so the pipeline's checkout has to be
`fetch-depth: 0`. On a tagged commit this returns `1.4.2`; five commits later it
returns `1.4.2-5-gabc1234`. That second form is not a defect — it reads as "not a
release" at a glance, which is exactly what it is.

## Reading it back

Three ways, all answering the same question:

```bash
curl -s https://app.example.com/api/health | jq '{version, commit, builtAt}'
docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' widgets:1.4.2
```

…and the footer, for anyone who has the page open and no terminal.

## Locally

Nothing is baked into a dev server, so the footer reads `Version dev` with no
sha, and `/api/health` reports an empty `commit`. An unknown commit shows as
unknown rather than as a plausible-looking wrong one.

To see real values against the production image:

```bash
APP_VERSION=1.4.2 GIT_SHA=$(git rev-parse HEAD) battlestack prod
```

The compose `app` service forwards both from your shell.

## Overriding at runtime

`NUXT_PUBLIC_APP_VERSION`, `NUXT_PUBLIC_APP_COMMIT`, `NUXT_PUBLIC_APP_BUILT_AT`
and `NUXT_PUBLIC_APP_REPO_URL` override the baked values at container start,
because Nitro reads `NUXT_PUBLIC_*` then.

Useful for a repo URL that differs per environment. Not useful for the version
or the commit: an image that reports a commit it was not built from is worse
than one that reports nothing, since it is wrong rather than merely silent.

## If the footer says `dev` in production

In order of likelihood:

1. The pipeline is not passing the build args. It is the only thing that can.
2. `nuxt.config.ts` lost the `runtimeConfig.public.appVersion` / `appCommit`
   keys. Nuxt ignores a `NUXT_PUBLIC_*` env var whose key is not declared there,
   silently. `battlestack pull` puts them back.
3. The image predates `shared:docker` 1.2.0. Rebuild it.
