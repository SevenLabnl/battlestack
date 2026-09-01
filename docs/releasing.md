# Releasing

## The model

| Ref | Meaning |
| --- | --- |
| `main` | Integration branch. Every merge runs CI. Merging publishes nothing. |
| `production` | The commit behind the current `latest` on npm. Moved by the Release workflow only. |
| `v<version>` tag | A version that npm accepted. Created after the publish succeeds, never before. |
| `release/v<version>` branch | Machine-owned version bump branch, opened by Prepare release. |

All five publishable packages share one version and cross-depend with
`workspace:*`, so there is exactly one number per release and one tag to match
it. `pnpm version:check` is a CI gate that fails the build if they drift apart.

Publishable packages:

- `battlestack` (the `npx battlestack` / `bstack` wrapper, the only package with `bin` entries)
- `@battlestack/cli`
- `@battlestack/core`
- `@battlestack/preset-nuxt4`
- `@battlestack/tui`

## Cutting a stable release

1. **Actions -> Prepare release -> Run workflow** from `main`, pick `patch`,
   `minor` or `major`. It bumps all five `package.json` files, prepends a
   `CHANGELOG.md` stanza and opens a PR titled `release: v<version>`.
2. Review and merge that PR. This is where the version number gets human
   approval. CI runs on it like any other PR, because the branch and the PR are
   authored with `RELEASE_PR_TOKEN` rather than `GITHUB_TOKEN`.
3. **Actions -> Release -> Run workflow** from `main` with `dry_run: false` and
   `channel: auto`.
4. The `Gate` job runs the lockstep check, the unpublished check, the
   moves-the-dist-tag-forward check, typecheck, tests, build and the
   packed-tarball smoke test.
5. The `Publish` job waits for a `release` environment reviewer. Approve it.
6. On success the workflow publishes to npm, pushes the annotated `v<version>`
   tag, fast-forwards `production` and creates the GitHub release.

Leave `dry_run: true` (the default) to run every gate and pack the tarballs
without publishing. A dry run may be dispatched from any branch and keeps
working after a release ships: the tag-exists, already-published and
moves-forward checks downgrade to warnings for it, so the steady state on
`main` (current version tagged and on npm) rehearses green. A real publish may
only be dispatched from `main`, and Prepare release only runs from `main`.

A dry run runs entirely inside `Gate` and the `Publish` job is skipped, so it
needs no reviewer approval and is not subject to the `release` environment's
`main`-only deployment branches.

## Cutting a `next` prerelease

1. **Prepare release** with `level: preminor` (or `prepatch` / `premajor` /
   `prerelease`) and `preid: next`. From `0.2.0` that produces `0.3.0-next.0`.
   Running `prerelease` again produces `0.3.0-next.1`.
2. Merge the PR, then run **Release** with `dry_run: false`. `channel: auto`
   resolves the dist-tag from the prerelease identifier, so it publishes under
   `next`.
3. Users install it with `npx battlestack@next`. A plain `npx battlestack` is
   unaffected.

A prerelease gets a `v<version>` tag and a GitHub release marked prerelease. It
does **not** move `production`, because `production` tracks `latest`.

To graduate a prerelease, run **Prepare release** with `patch`, `minor` or
`major`: `0.3.0-next.3` plus `minor` becomes `0.3.0`.

The workflow refuses to publish a prerelease version under the `latest`
dist-tag.

## Local commands

```sh
pnpm version:print              # the current lockstep version
pnpm version:check              # all five agree, internal deps are workspace:*, a bin exists
pnpm version:bump minor         # rewrite all five package.json files
pnpm version:bump prerelease --preid next
pnpm version:set 1.0.0
pnpm version:changelog          # prepend a stanza for the current version
pnpm pack:smoke                 # build, pack, install the tarballs, run the binary
```

## One-time setup

**GitHub repository settings**

- Settings -> Environments -> `release`: add required reviewers, and set
  deployment branches to `main` only.
- Settings -> Actions -> General: enable "Allow GitHub Actions to create and
  approve pull requests" so Prepare release can open its PR.
- Settings -> Secrets and variables -> Actions: add `RELEASE_PR_TOKEN`, a
  fine-grained PAT or GitHub App installation token with **Contents: write** and
  **Pull requests: write** on this repository. Prepare release refuses to run
  without it, on purpose: GitHub runs no workflows for a push or PR authored by
  the built-in `GITHUB_TOKEN`, so a release PR opened with it would show zero
  checks and a `main` with required status checks could never merge it.
- Settings -> Branches: protect `main` and `production`. `production` needs to
  accept a push from `github-actions[bot]`, so either leave it unprotected
  against that actor or add the bot to the bypass list.

**npm**

Every package uses Trusted Publishing, so no `NPM_TOKEN` exists. On npmjs.com,
for each of the five packages: Settings -> Trusted Publisher -> GitHub Actions,
with repository `SevenLabnl/battlestack`, workflow `release.yml` and environment
`release`.

## Recovering from a failed release

- **Gate failed.** Nothing was published, nothing was tagged. Fix and re-dispatch.
- **Gate refused the version.** Either the `v<version>` tag exists, the version
  is already on npm, or it is not newer than the current `latest`. All three mean
  the number is spent: run **Prepare release** for a new one.
- **Publish failed halfway.** Some packages are on the registry, no tag exists.
  Re-dispatch the same run: `pnpm -r publish` skips what already landed. The
  Gate job reports which packages are already published and continues.
- **Publish succeeded, tag or promote failed.** Push the tag by hand from the
  release commit, then `git push origin main:production`.
- **A bad version reached npm.** `npm deprecate` it and release a fix forward.
  Unpublishing is possible for 72 hours only and breaks anyone who installed it.
