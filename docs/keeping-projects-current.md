# Keeping a project current

This is the part that separates battlestack from a starter kit. A project you
scaffolded months ago is not frozen at the moment you created it.

## Why this works at all

Starters hand you the wiring once. From that moment your copy drifts, and a fix
upstream never reaches you.

battlestack projects carry a manifest recording which feature versions produced
which files, along with a content hash per file. From that record battlestack can
tell whether a feature has moved on since the project was created, and whether a
file has changed since battlestack wrote it. `doctor` reports both; `pull` acts
on them.

## The commands

```bash
battlestack doctor    # what is out of date or drifted. Read-only.
battlestack pull      # apply template and config changes, drift-aware
battlestack bump      # bump npm dependencies to latest
battlestack sync      # pull, then bump, then doctor
```

`battlestack upgrade` is an alias for `pull`, named for the common case of
picking up feature version bumps.

Start with `doctor`. It changes nothing, so there is no reason not to.

## Before you pull

Commit or stash your work first. `pull` refuses to run in a working tree with
uncommitted changes, because git is how you review what it did and undo it if
you need to. `--allow-dirty` overrides that, and costs you the ability to tell
your changes from the pull's.

A project without `.battlestack/manifest.json` is not a battlestack project yet.
`pull` says so instead of starting a new project. If a plugin can convert it from
another tool, `battlestack migrate` lists the conversions on offer.

## What pull actually does per file

For every file a feature writes, `pull` compares the file on disk with the hash
recorded when battlestack last wrote it, and with the new content.

| Situation | What happens |
| --- | --- |
| **Pristine**: untouched since battlestack wrote it | Updated in place. |
| **Missing**: you deleted a tracked file | Restored, and listed in the report. |
| **Converged**: your edit happens to match the new version | Recorded as up to date. Nothing written. |
| **Owned**: you claimed it with `battlestack own` | Skipped entirely. |
| **Edited**: you changed it, and upstream changed too | Merged. See below. |

An edited file is merged three ways: the version battlestack last wrote, your
version, and the new one. Changes on different lines all land in the file. Where
you and upstream changed the same lines, the file gets conflict markers with
both versions and the original between them:

```
<<<<<<< server/utils/auth.ts (yours)
||||||| server/utils/auth.ts (upstream before, nuxt4:auth)
=======
>>>>>>> server/utils/auth.ts (upstream now, nuxt4:auth)
```

The version battlestack last wrote comes from `.battlestack/base/`, which
holds those versions by content hash. Commit it with the rest of the project so
everyone's next pull can merge. On a project's first merge, before that directory
exists, `pull` finds the version in git history instead. When neither has it, the
file is left as it is and the new version is staged as
`.battlestack/pull/<path>.new` for you to compare by hand.

The same rules apply to a feature that is new to the project. If it ships a file
at a path where you already have your own, yours stays and the feature's version
is staged.

## After the pull

`pull` writes `.battlestack/pull/REPORT.md` and prints its path. The report
lists every conflict, staged file, new file and backup, along with steps it
cannot take for you, such as GitHub variables a deploy workflow now reads. Each
section says how to handle its files. The command exits with code 2 while there
is anything in it to do, so CI and scripts can tell "finished with work left"
from a crash.

Projects get a `battlestack-upgrade` skill that walks an AI agent through the
report. The short version for people: resolve the conflict markers
(`git diff --check` finds any left), compare each staged `.new` with your file,
check whether each new file is something the project deleted on purpose, run
lint, typecheck and the tests, and commit. `pull` refuses to start again while
a conflict marker is left in a merged file.

## Moving template files

When a template stops shipping a tracked path, `pull` removes the old hash record.
It deletes the file only if it still matches the recorded baseline, is not
explicitly user-owned, and no other enabled feature still owns the same path.
Modified or explicitly owned obsolete files stay on disk and are reported.
Their edits are not automatically transferred to a replacement path.

The user-form validation update moves
`server/utils/password-policy.ts` to `shared/utils/password-policy.ts`.
Untouched projects receive the shared helper, updated imports and forms, and the
old helper is removed. Fresh scaffolds ship only the shared path.

For a customized project:

1. Run `battlestack doctor`, then `battlestack pull`.
2. Resolve what `.battlestack/pull/REPORT.md` lists for customized forms and API
   handlers. Explicitly owned paths are skipped rather than merged; compare them
   with the new templates manually.
3. If the old policy was retained, port deliberate policy changes to the shared
   helper and update every import to `#shared/utils/password-policy`.
4. Remove the retained old helper once no caller uses it. Leaving both utilities
   can produce duplicate Nuxt auto-imports; keeping a compatibility re-export is
   not required. `pull` prints a note for as long as the old helper or
   `server/utils/password-policy.test.ts` is still on disk; move that test's
   cases to `test/unit/password-policy.test.ts`.
5. Run the project's unit/Nuxt tests, typecheck and lint, then restart the dev
   server so its auto-import index reflects the moved file.

`pull` records the new feature version even if a staged or owned file was skipped.
A second normal pull does not retry that version. After deliberately resolving
those files, use `battlestack pull --force` to reapply it. `--overwrite` alone
changes file protection, not the feature-version gate; reapplying an already
recorded version with a deliberate reset requires `--force --overwrite`.
Neither option automatically ports custom code from a retired file.

## When you want it to just overwrite

```bash
battlestack pull --force
```

Overwrites drifted files, saving your version first as
`.battlestack/pull/<path>.bak`. Your content still exists; it just is not the
one on disk any more.

```bash
battlestack pull --overwrite
```

Overwrites every shipped file, keeping no artefacts at all. This is the blunt
instrument: "put this project back to exactly what battlestack would generate".
It confirms first if any files are owned.

Reach for `--force` when you have read the conflicts and decided upstream is
right everywhere. Reach for `--overwrite` when you want a clean slate.

## Narrowing what pull touches

| Flag | Effect |
| --- | --- |
| `--skills-only` | Refresh only the AI-agent skills, nothing else. |
| `--no-skills` | Skip the skill refresh. |
| `--no-format` | Skip the trailing formatting pass. |
| `--skip-install` | Skip the dependency install. |

`--skills-only` is the quick one: pick up improved agent instructions without
touching a line of application code.

## Owning a file

Some files stop being battlestack's business. A layout you rewrote, a config you
tuned for your deployment. Rather than fighting `pull` about it every time:

```bash
battlestack own app/layouts/default.vue
battlestack own nuxt.config.ts app/pages/index.vue
```

`pull` then skips those paths permanently. No drift reports, no artefacts, no
prompts.

```bash
battlestack disown app/layouts/default.vue
```

Hands it back, and `pull` manages it again.

Some paths are yours from the moment of scaffold, because a feature declared them
structural: files you are obviously expected to edit. You do not need to `own`
those.

## Bumping dependencies

```bash
battlestack bump
```

Separate from `pull` on purpose. `pull` is about what battlestack generates;
`bump` is about the npm ecosystem underneath. They fail for different reasons and
you will often want one without the other.

`bump` respects the supply-chain release-age policy: a package published minutes
ago is the one most likely to be compromised, so new releases are held back for
3 days. When nothing older satisfies a range, pnpm installs the newer release
rather than failing.

## Doing it all at once

```bash
battlestack sync
```

`pull`, then `bump`, then `doctor`. The routine for coming back to a project
after a few months. Read the `doctor` output at the end rather than skimming to
the exit code.

## What doctor checks

- Feature versions that have moved on since your project was created.
- Files that drifted from what battlestack wrote.
- Missing or incomplete configuration.
- Environment readiness: Node, package manager, Docker, git.
- Ports, and what is holding them.
- Stale records and orphaned plugin references.

It is read-only. Nothing in this list gets fixed behind your back.

## Cleaning up afterwards

```bash
battlestack cleanup
```

Interactive. Finds `pull` artefacts you have finished merging, stale manifest
records, and Docker resources detached from any current project, including
those under a name the project had before `battlestack rename`. For a name the
manifest does not record, pass it:

```bash
battlestack cleanup old-name
```

Artefact patterns are gitignored by the generated `.gitignore`, so an unmerged
artefact cannot accidentally land in a commit.

## A workable routine

**Every few weeks**, or when you hear a fix landed:

```bash
battlestack doctor
battlestack pull
```

**Before a release**, or after a long gap:

```bash
battlestack sync
battlestack test
```

**After changing which features you use**:

```bash
battlestack add <feature>     # or remove
battlestack doctor
```

## Doing this in a team

Commit the manifest. It is what makes all of the above work for everybody rather
than only the person who ran the scaffold.

Treat a `pull` like any other change: run it on a branch, read the diff, let CI
check it, review it. It is not a special operation that bypasses your normal
process, and the drift artefacts are designed to be readable in review.

Do not commit `.battlestack/pull/` artefacts. Merge them, then delete them, or
let `battlestack cleanup` do it.
