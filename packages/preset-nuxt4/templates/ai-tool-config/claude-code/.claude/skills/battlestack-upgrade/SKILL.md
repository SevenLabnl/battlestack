---
name: battlestack-upgrade
description: Upgrade a battlestack project to the latest feature versions with `battlestack pull`, and finish what the pull leaves behind. Use when asked to upgrade, update or pull battlestack, when `.battlestack/pull/REPORT.md` exists, when `battlestack pull` exits with code 2, when a pull changed files under `server/database/schema/`, or when files contain conflict markers labelled "(yours)" and "(upstream now, <feature>)".
---

# Upgrading a battlestack project

`battlestack pull` brings every installed feature up to its latest version. It never throws away local work: a file you edited is merged with the new upstream version, and anything it cannot settle on its own is listed in `.battlestack/pull/REPORT.md`. Your job is to finish that list so the project builds, passes its checks, has a migration for every schema change and keeps every deliberate local change.

## Before the pull

Start from a clean working tree on a new branch. Pull refuses to run with uncommitted changes, because git is how the result gets reviewed and, if needed, undone.

```bash
git switch -c chore/battlestack-upgrade
battlestack pull
```

Run it from the project folder. In a monorepo that is the app's folder, not the repository root; pull only looks at changes inside the project folder.

A project without `.battlestack/manifest.json` cannot be pulled. If it was made with an older tool, run `battlestack migrate` to see which conversions the installed plugins offer, run the one that applies, commit its result on its own, and pull after that.

`.battlestack/base/` holds the upstream versions pull merges against. It must be committed. Without it, edited files can only be staged for a manual merge instead of merged.

## Reading the result

Exit code 0 means nothing needs attention. Exit code 2 means the pull finished and left work, and the console ends with the path to the report. Read the whole report before changing anything. Its sections are ordered by urgency, so work through them top to bottom, and read the console output too: warnings such as a migration that drops a column are printed there.

Files the project claimed with `battlestack own` are never touched by a pull, so they do not appear in the report.

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

## Schema changes and migrations

Production applies only the committed SQL in `server/database/migrations/`, so every schema change needs a migration in the same commit.

When a pull changes a file under `server/database/schema/`, it runs `db:generate` itself and prints the name of the new SQL file. Read that file before you commit it.

When the report lists a migration step instead, finish it yourself:

1. Merge every conflicted or staged file under `server/database/schema/` first. Pull does not generate while one is unfinished, because the schema on disk is not the final one yet.
2. Run the project's package manager in a terminal, for example `pnpm run db:generate`. A renamed column or table makes drizzle-kit ask whether it is a rename or a drop and add, and that question needs an interactive terminal. Answer it with what the schema change means, and ask the user when you cannot tell.
3. Read the new SQL. Every `DROP COLUMN` and `DROP TABLE` deletes data in production. Make sure each one is intended, and ask the user before committing one that was not part of the upgrade.

A staged `.new` for a schema file is the upstream version only, without the project's own columns. Never copy it over the project's file: generating a migration from it drops those columns. Merge it line by line like any other staged file.

If pull warns that a migration drops a column a feature needs, such as `users.avatar_key` on a project with storage, that migration came from an earlier upgrade and would delete data on the next deploy. Tell the user before doing anything else. Unless they meant it, remove that migration together with its entry in `server/database/migrations/meta/_journal.json` and its snapshot, restore the column in the schema, and generate again.

## New files and restored files

Pull lists every file it created. Some belong to a feature that is new to the project, others are files the project once deleted. For each one, check whether the deletion was deliberate:

```bash
git log --diff-filter=D --oneline -- <path>
```

If a commit removed it on purpose, the project does not want that feature. Remove it properly with `battlestack remove <feature>`, which deletes its files and keeps later pulls from bringing them back. Deleting the files again by hand only lasts until the next pull.

## Local edits a feature wrote over

Some features write a file in a way pull cannot check beforehand. When one replaced a file that had local edits, pull put the project's version back and merged or staged the feature's version; the report lists those files and where each one ended up. Check the result like any other conflict or staged file.

## Backups, unmanaged files and outside steps

Backups under `.battlestack/pull/*.bak` are the project's versions of files that were replaced. Most are local edits to files regenerated on every pull, such as `AGENTS.md`: move whatever is still useful into `CLAUDE.project.md`, which pull never touches, then delete the backup. A `.bak` from a `--force` run holds edits the user chose to replace; mention it to them before deleting it.

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

Fix what fails, then commit, including `.battlestack/` and any new migration. A good commit message names the feature upgrades, lists every conflict you resolved by keeping the project's version over upstream, and names each migration.

Then run `battlestack pull` once more. It should report every feature as up to date and exit with code 0. If it does not, something is still unfinished.

## Never

- Never run `battlestack pull --force` or `--overwrite` to make conflicts go away. `--force` replaces the project's edits with upstream and keeps them only as `.bak` files; `--overwrite` does not keep them at all.
- Never edit hashes in `.battlestack/manifest.json` by hand or delete `.battlestack/base/`. The next pull needs both to merge correctly.
- Never resolve a conflict by taking the upstream side wholesale without reading what the project's side did.
- Never copy a staged schema `.new` over the project's file, and never commit a migration you have not read.
