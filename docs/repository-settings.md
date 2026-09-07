# Repository settings

Some guarantees this project relies on are GitHub configuration, not code. They
cannot be enforced from the repository, so they are recorded here and applied
deliberately. A setting that only ever lived in a settings page is one nobody can
review and nobody notices losing.

## What gates `main`

Two rulesets apply, and they stack. The most restrictive rule wins, so each one
only has to state its own concern.

| Ruleset | Source | Enforces |
| --- | --- | --- |
| `Require PR approval` | Organization (`SevenLabnl`) | One approving review, stale reviews dismissed on push, review threads resolved, no deletion, no force-push. |
| `Require CI to pass` | This repository | The six CI checks must succeed before a pull request can merge. |

The organization ruleset also covers `development`, `staging` and `master`, and
changing it needs organization admin. That is why the CI requirement is a
separate repository-level ruleset: it targets only the default branch and can be
reviewed and applied without touching other repositories.

## The CI requirement

[`.github/rulesets/require-ci-to-pass.json`](../.github/rulesets/require-ci-to-pass.json)
is the definition. It requires every job in [`ci.yml`](../.github/workflows/ci.yml):

```
Feature version bump check
Type-check and test (Node 24)
Type-check and test (Node 26)
Type-check, test, build, CLI smoke (Windows, Node 24)
Type-check, test, build, CLI smoke (Windows, Node 26)
Scaffold a project and run its own gates
```

Each context is pinned to `integration_id: 15368`, the GitHub Actions app, so
another app cannot satisfy a requirement by posting a check that merely shares a
name.

Contexts are matched by the job's **display name**, not its key. Renaming a job's
`name:` in `ci.yml` silently stops satisfying the requirement, and the pull
request waits forever on a check that will never report under the old name.
Rename the job and this file together.

`ci.yml` triggers on every `pull_request` with no path filter, so all six always
run. That matters: a required check that never reports blocks a pull request
indefinitely rather than failing it.

### Applying it

```
gh api -X POST repos/SevenLabnl/battlestack/rulesets \
  --input .github/rulesets/require-ci-to-pass.json
```

Updating an existing one needs its id, which `gh api
repos/SevenLabnl/battlestack/rulesets` lists:

```
gh api -X PUT repos/SevenLabnl/battlestack/rulesets/<id> \
  --input .github/rulesets/require-ci-to-pass.json
```

Verify what is actually live, rather than trusting this file:

```
gh api repos/SevenLabnl/battlestack/rulesets/<id>
```

### If CI itself breaks

Do not delete the ruleset. Set `"enforcement": "evaluate"` and re-apply, which
reports results without blocking, then set it back to `"active"`. A deleted
ruleset is easy to forget to restore; a downgraded one shows up in the rulesets
list.

## Deliberate choices

**Strict mode is off.** `strict_required_status_checks_policy: false`, so a
branch does not have to be up to date with `main` to merge. Turning it on means
rebasing every pull request whenever `main` moves, and `allow_update_branch` is
`false`, so there is no one-click update to do it with. Enable both together or
neither.

The trade is real: without strict mode, two pull requests that each pass alone
can break `main` together. The bump-check gate is the likely case, because it
diffs against `origin/main`, so two branches bumping the same feature to the same
version both pass and the second breaks after merge. Worth knowing rather than
being surprised by.

**No bypass actors.** Nobody can merge past a failing check. The organization
ruleset grants a `pull_requests_only` bypass for the approval requirement, which
does not extend here.

## Auto-merge

Auto-merge is currently **off** (`allow_auto_merge: false`), so the button does
not appear on a pull request.

It is worth understanding the order of operations before enabling it. Auto-merge
waits for required checks and required reviews, and merges when they are all
satisfied. With no required status checks it would merge the moment an approval
landed, regardless of CI, which is the opposite of what it looks like it does.
Enabling auto-merge is only safe once the CI requirement above is live:

```
gh api -X PATCH repos/SevenLabnl/battlestack --field allow_auto_merge=true
```

Note also that GitHub does not allow approving your own pull request. With one
required approval, a solo pull request needs another reviewer or a bypass, and
auto-merge will wait rather than merge.

## Release interaction

The release flow depends on this and already accounts for it. GitHub runs no
workflows for a push or pull request authored by the built-in `GITHUB_TOKEN`, so
a release pull request opened with it would show zero checks and could never
satisfy a required check.

[`prepare-release.yml`](../.github/workflows/prepare-release.yml) therefore
authors both the push and the pull request with `RELEASE_PR_TOKEN`, and refuses
to run when that secret is missing. Keep it configured. See
[Releasing](releasing.md) for the rest of the one-time setup.

`release.yml` pushes only a tag and the `production` branch, never `main`, so
nothing in the publish path is affected.
