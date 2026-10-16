---
name: battlestack-upgrade
description: Upgrade a battlestack project to the latest feature versions with `battlestack pull`, and finish what the pull leaves behind. Use when asked to upgrade, update or pull battlestack, when `.battlestack/pull/REPORT.md` exists, when `battlestack pull` exits with code 2, or when files contain conflict markers labelled "(yours)" and "(upstream now, <feature>)".
---

# Upgrading a battlestack project

`battlestack pull` brings every installed feature up to its latest version. It never throws away local work: a file you edited is merged with the new upstream version, and anything it cannot settle on its own is listed in `.battlestack/pull/REPORT.md`. Your job is to finish that list so the project builds, passes its checks and keeps every deliberate local change.

## Before the pull

Start from a clean working tree on a new branch. Pull refuses to run with uncommitted changes, because git is how the result gets reviewed and, if needed, undone.

```bash
git switch -c chore/battlestack-upgrade
battlestack pull
```

A project without `.battlestack/manifest.json` cannot be pulled. If it was made with an older tool, run `battlestack migrate` to see which conversions the installed plugins offer, run the one that applies, commit its result on its own, and pull after that.

## Reading the result

Exit code 0 means nothing needs attention. Exit code 2 means the pull finished and left work, and the console ends with the path to the report. Read the whole report before changing anything. Its sections are ordered by urgency, so work through them top to bottom.

## Conflicts

Both the project and upstream changed the same lines. The file holds diff3 markers, shown indented here; in the file they start at the beginning of the line:

```
  <<<<<<< server/utils/auth.ts (yours)
  what the project has now
  ||||||| server/utils/auth.ts (upstream before, nuxt4:auth)
  what upstream shipped last time
  =======
  what upstream ships now
  >>>>>>> server/utils/auth.ts (upstream now, nuxt4:auth)
```

Compare each side with the middle section. The difference between "upstream before" and "yours" is the project's deliberate change. The difference between "upstream before" and "upstream now" is the fix or feature being delivered. Keep the project's intent and apply the upstream change on top of it. When the two cannot both hold, keep the project's behaviour and tell the user which upstream change you left out and why.

Run `git log -p -- <file>` when you cannot tell why the project changed a line. `git diff --check` lists any marker left behind, and the next pull refuses to start until there are none.

## Staged files

No earlier upstream version of these files was found, so nothing was merged and the project's file is untouched. The new upstream version is in `.battlestack/pull/<path>.new`. Diff it against the project's file and carry over the upstream changes that apply. Do not apply the `.patch` next to it: it replaces the whole file with upstream and drops the project's changes. Once the file is merged, delete its `.new` and `.patch`.

A staged file the project never had under that path at all, such as a feature's route that would replace one of the project's own, usually means the feature and the project want the same path. Ask the user which one should win before changing anything.

## New files and restored files

Pull lists every file it created. Some belong to a feature that is new to the project, others are files the project once deleted. For each one, check whether the deletion was deliberate:

```bash
git log --diff-filter=D --oneline -- <path>
```

If a commit removed it on purpose, the project does not want that feature. Remove it properly with `battlestack remove <feature>`, which deletes its files and keeps later pulls from bringing them back. Deleting the files again by hand only lasts until the next pull.

## Backups, unmanaged files and outside steps

Backups under `.battlestack/pull/*.bak` are local edits to files that are regenerated on every pull, such as `AGENTS.md`. Move whatever is still useful into `CLAUDE.project.md`, which pull never touches, then delete the backup.

Files listed as no longer managed were dropped by their feature but kept because the project edited them. Find out whether anything still uses each one. Delete it if not, and leave it as the project's own file if so.

Steps outside the repository, such as GitHub variables or secrets, cannot be done from here. Copy them into your summary for the user word for word, and do not invent values for secrets.

## Finishing

Install, then run the checks the project's CI runs:

```bash
pnpm install
pnpm run lint
pnpm run typecheck
pnpm test
```

Fix what fails, then commit. A good commit message names the feature upgrades and lists every conflict you resolved by keeping the project's version over upstream.

## Never

- Never run `battlestack pull --force` or `--overwrite` to make conflicts go away. Both replace the project's edits with upstream.
- Never edit hashes in `.battlestack/manifest.json` by hand or delete `.battlestack/base/`. The next pull needs both to merge correctly.
- Never resolve a conflict by taking the upstream side wholesale without reading what the project's side did.
