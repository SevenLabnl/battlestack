# Contributing

## Prerequisites

- Node >= 24.
- A package manager: **pnpm** is the default — this repo and its CI use it.
  **npm** and **bun** also work; see the matrix below for exactly what has
  been proven. **yarn is not supported** (some emitted scaffolding breaks
  under yarn classic).

### What "works" has actually been verified against

Two separate things get called "package manager support" here, and conflating
them is how this section previously came to claim more than was true. They are
verified independently:

**As the tool that installs `battlestack` itself** — pack the five packages,
install *only* those tarballs into a fresh consumer, run the installed binary.
`scripts/pack-smoke.mjs` covers pnpm; `scripts/pack-smoke-matrix.mjs` covers
npm and bun. All three pass.

**As the package manager of a scaffolded project** (`--pm`) — tarball install →
real scaffold → real `nuxt build`, asserting `.output/server/index.mjs` exists
rather than trusting an exit code:

| template | pnpm | npm | bun |
| --- | --- | --- | --- |
| `nuxt4-minimal` | ✅ | ✅ | ✅ |
| `nuxt4-fullstack` | ✅ | ✅ | not run |

Two limits worth stating plainly rather than rounding off:

- **bun × `nuxt4-fullstack` has never been run.** It is not known to fail; it
  is unknown.
- **None of this runs in CI.** Both scripts are manual (`pnpm pack:smoke`,
  `pnpm pack:smoke:matrix`), so this matrix can go stale between one run and
  the next without anything turning red. Re-run them before trusting it, and
  update the table when you add a template or a package manager.

## Commands

```bash
pnpm install     # workspace install
pnpm tsc         # type-check every package's src + test, --noEmit
pnpm test        # vitest, all packages
pnpm build       # tsc -b: core -> tui -> preset-nuxt4 -> cli, in dependency order
pnpm pack:smoke  # build, pack, install the tarballs into a throwaway project,
                 # run the installed binary's --version/--help — proves the
                 # packed binary executes and the preset's template payload
                 # ships. It does not scaffold or build a project.
```

`packages/*/templates/**` is scaffold *payload*, copied verbatim into
generated projects — it references a generated project's own Nuxt aliases
and deps, none of which resolve here, so it's deliberately excluded from
`pnpm tsc`. That same tree must stay **LF** (enforced by `.gitattributes`):
the copy path never translates line endings, so whatever's committed is
exactly what a scaffolded project gets.

## Package versions are separate from feature versions

The five publishable packages share one lockstep version, checked in CI by
`pnpm version:check`. A feature's `version` is unrelated to it and is not a
release number. See [docs/releasing.md](docs/releasing.md) for how a release is cut:
merging to `main` publishes nothing, a release is a manual dispatch plus an
environment approval.

## Features carry a version — bump it when output changes

Every `Feature` has a `version` (semver). `battlestack pull` uses it to
detect drift in an already-scaffolded project: a feature whose version is
unchanged is reported "up to date" and its `update()` never runs. So if you
change what a feature emits — a template's content, which files it writes —
bump the version, or existing projects never see the update.

**`collectDocs` and `collectEnv` need a second bump.** Those hooks don't write
anything themselves; they're aggregated across every enabled feature and
written by one owner — `nuxt4:docs` writes `AGENTS.md`/`README.md`/`CLAUDE.md`,
`shared:env` writes `.env`. `pull` version-gates on the feature that *writes*
a file, not the one that contributed the text. Changing your feature's
`collectDocs` output and bumping only your own version therefore reaches new
scaffolds and no existing project. Bump the writing feature too.

## Testing: a test must be able to fail

Every assertion should survive one question: **if I delete the behaviour this
checks, does this test go red?** If it stays green it is protecting the
illusion of coverage, which is worse than no test, because it makes the
eventual real fix look like a regression. After writing an assertion, remove
the thing it asserts, watch it fail, and put it back.

Two rules follow from that.

**1. Fixtures must be in the shape production produces.** Build registries
through the real loader path (`applyPlugin` → `finalizeRegistries`) via
`buildRegistries` in `packages/cli/test/test-utils.ts`. Hand-assembled
`Template`/`Framework` objects leave bare ids equal to fully-qualified ids, a
shape production never generates, and any comparison that confuses the two is
then invisible. Where a test depends on canonicalization, assert the fixture's
shape directly (`expect(...requiredFeatures).toEqual(['ns:domain:feature'])`),
so a regression in the helper cannot flatten the two spellings back together
while every test keeps passing.

**2. A test for a mutual-exclusion property must include the disabled run.**

> A test that cannot detect the removal of the thing it tests is not a test.
> Where the mechanism can be disabled, the disabled run is a required
> component of the test, not a nicety.

This covers locks, guards, mutexes, transactions and rate limiters: anything
whose job is to *prevent* something rather than produce it. Concurrency is
where it bites hardest, because a race that never actually races goes green
without contending, and nothing in the output distinguishes "the lock worked"
from "nothing contended".

`scripts/migrate-lock-race.mjs` is the worked example. It races real migrator
processes against real Postgres, asserts exactly one applies each migration,
and also runs every scenario against a copy with the `pg_advisory_lock` call
stripped out, failing if that copy passes.

`scripts/replica-race.mjs` applies the same rule to the opposite property.
Where a lock must stop something happening twice, the cache bus must make
something happen everywhere, so its scenarios assert that all four replicas
drop an entry and its controls strip one mechanism each: the `LISTEN`
subscription for the first scenario, the reconnect callback for the second.
The cache TTL is pinned far above the run length on purpose. Expiry and
invalidation look identical from outside, so a short TTL would let every
scenario pass without the bus doing anything.

Both scripts need a real database and a scaffolded project, and neither runs
in CI for that reason:

```
NUXT_DATABASE_URL=postgres://... pnpm race:migrate-lock --project <dir>
NUXT_DATABASE_URL=postgres://... pnpm race:replicas --project <dir>
```

> If a control stops tripping, that is a red result **about the test**, never a
> reason to relax the assertion. Widen the contention window until it trips
> again.

**Known defects go in the task list, not the suite.** A bug you've found but
can't fix does not become a passing test that documents it. A suite that
reports health it doesn't have is worse than a gap you can see.

## CI

Every push/PR runs, on Node 24 and 26: type-check and the full test suite. A
native Windows job type-checks, tests, builds, smoke-tests the CLI binary, and
then scaffolds a real `nuxt4-fullstack` project and asserts on the result —
files present, manifest parseable, template payload still LF. Windows is a
supported target rather than an assumed one, and that last step is what makes
it a claim rather than a hope. All of it runs on hosted
runners — this is the public repo, so CI has to work unmodified on a
stranger's fork.
