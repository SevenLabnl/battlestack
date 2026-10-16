# Changelog

## Unreleased

- A skill whose `skills add` fails no longer ends the run on a plain "Scaffold
  complete" or "Update complete": the closing line names the skills that were
  not installed. The warning points at access (`gh auth login` or git
  credentials for the source's host) and `battlestack pull --skills-only`, not at
  the registry.

- `pull` updates features in the order a scaffold runs them, not alphabetically.
  A file that moved to a feature with a later stage but an earlier id was
  deleted: the new owner passed it by first, then the old owner removed it as
  obsolete. 1.4.0 lost `test/e2e/api/auth.test.ts` this way when it moved from
  `nuxt4:vitest` to `nuxt4:auth`. A project that already lost it gets it back
  the next time `nuxt4:auth` is bumped, or now by copying it from the template.

## v1.4.0 (2026-10-15)

- Keep the generated `AGENTS.md` short: feature sections move to
  `docs/battlestack/<feature>.md`, and `AGENTS.md` keeps the house rules plus one
  pointer line per file (60 KB to 6.5 KB for a full-featured project). On `pull`,
  an edited generated doc is backed up under `.battlestack/pull/`, an owned one
  is left alone, and a disabled feature's pristine doc is removed.
- Show localized inline email/password validation in user-admin create/edit and
  signup forms; reuse the canonical password policy and display API error details.
- Run emitted password-policy and Nuxt form regression tests in generated projects.
- Preserve explicitly owned obsolete template files during updates, including
  the password-policy move from `server/utils/` to `shared/utils/`.
- Translate API password-policy rejections in signup and user-admin forms,
  validate the user-admin name length before sending, and clear a stale create
  error when the dialog reopens.
- Warn on `pull` when an old `server/utils/password-policy.ts` or its test stays
  beside the shared policy.
- Include `shared/**` in generated Vitest coverage.
- Pin generated projects to TypeScript 6: `vue-tsc` and typescript-eslint do not
  support TypeScript 7 yet. A feature's explicit dependency range now also wins
  over a peer pin that `nuxi module add` wrote into the other bucket.
- Install the lefthook git hooks: generated projects get a
  `prepare: lefthook install || exit 0` script, and `pull` runs it once.
- Format the template files with the generated project's own ESLint config, so
  `pull` no longer turns style differences into merge conflicts. CI now lints
  the raw templates with that config.
- `battlestack <command> --help` prints that command's usage, and `--help`
  inside a project lists the core commands (`pull`, `own`, `doctor`, …).
- `/api/health` and `/api/health/ready` no longer return the database driver's
  error message, which could name the host or user; it goes to the server log.
  The same holds for a failed boot task such as the migration on boot: `boot.failed`
  now names the task, not its error.
- Ship Claude Code rules as `.claude/rules/*.md` with `paths:` frontmatter instead
  of Cursor-format `.mdc` files that Claude Code never loaded. Drop the always-on
  `rules/skills/` duplicates of the `.claude/skills/` workflows, the inert
  `.claude/hooks/hooks.json`, and the `k8s.mdc` entry in the generated `AGENTS.md`.
  Align the index naming rule with drizzle (`<table>_<cols>_idx`).
- Pin the production Dockerfile's `node:24-alpine` base image by digest in both
  stages, and remove npm, npx and corepack from the runtime stage, which only
  runs `node`. Updating the base image is now an explicit change to the digest.
- Index every `user_id` foreign key in the scaffold's schema (sessions, files,
  audit events, backup codes, passkeys, reset and verification tokens, OAuth
  accounts), so deleting a user no longer scans each of those tables. Existing
  projects get the schema change on `battlestack pull`; run
  `battlestack db:generate` afterwards and commit the new migration.
- Ship `test/e2e/api/auth.test.ts` with `nuxt4:auth` instead of `nuxt4:vitest`, so a
  project without auth (`nuxt4-minimal`) no longer fails its own e2e suite. `pull`
  removes the untouched file from such projects.
- The `with-db` health check no longer imports `nuxt4:auth`'s `session-password.ts`,
  so a template that enables `nuxt4:database` without `nuxt4:auth` builds. The
  built-in templates always pair them; a plugin template need not.
- `createTestUser` moved from `test/helpers/setup.ts` (`nuxt4:vitest`) to
  `test/helpers/users.ts` (`nuxt4:auth`) and no longer takes an admin cookie: it
  inserts the user directly instead of calling `nuxt4:user-admin`'s `POST /api/users`,
  so the auth-2fa and storage e2e suites pass without user-admin. Update your own
  tests to `import { createTestUser } from '~~/test/helpers/users'` and drop the
  first argument.

### Commits

- chore(deps): bump vitest from 5.0.3 to 5.0.4 in the dev-tooling group (bd26240)
- ci: require a changelog entry for changes that ship (8373b61)
- fix(release): fold the Unreleased notes into the release stanza (e87afb2)
- fix(preset-nuxt4): resolve the two template feature-scope violations (97a89a5)
- test(preset-nuxt4): state each optional call's real guard (cf52953)
- test(preset-nuxt4): check every template's feature scope, not only vitest's (fbc72c5)
- chore: bump auth past the stack base (65c1990)
- fix(bump-check): see the feature a file was moved out of (31d7da3)
- chore: bump auth and vitest past main (ae286d2)
- fix(vitest): ship the auth e2e test with nuxt4:auth (93aa8a5)
- ci: bypass the bump check with a skip-bump-check label (541bb05)
- chore: bump audit-log, auth-2fa, auth-recovery, auth-verification, auth and storage past main (f74fcde)
- chore: bump auth, vitest and docs past main (9881dd7)
- fix(auth): refuse revoked sessions on every request (3f08e8f)
- ci: correct why the theme job links the checkout (6efb206)
- chore: rebump after rebasing onto main (be03513)
- fix(ai-tool-config): point agents at the workflow skills from global.md (b0dd2e2)
- fix(ai-tool-config): ship Claude Code rules in a format Claude Code loads (4eb58d4)
- ci: install the theme scaffold without a frozen lockfile (01c90d2)
- chore: rebump after rebasing onto main (57595c4)
- fix(database): keep a boot task's error out of the health responses (da094c8)
- fix(health): keep the database error out of the public health responses (454c1b4)
- ci(dependabot): keep the template's digest-pinned node image current (25f85cf)
- ci: scaffold with the theme layer and build it (50c97d7)
- chore(deps): drop the postcss override (abde25d)
- chore(deps): regenerate the lockfile and update within ranges (482ee1e)
- fix(cli): print self-update's usage for `self-update --help` instead of running it (252b243)
- fix(preset-nuxt4): patch nuxt.config.ts without reformatting it (cec625c)
- fix(add): run the eslint --fix pass after adding a feature (fa91019)
- chore(deps): bump the dev-tooling group across 1 directory with 2 updates (26485a7)
- chore(deps): bump vite from 8.3.2 to 8.3.4 (5221261)
- chore(deps): bump @nuxt/kit from 4.5.2 to 4.6.1 (63076ad)
- Revert "fix(ai-tool-config): start Playwright MCP with the bundled Chromium" (a109c38)
- fix(ai-tool-config): start Playwright MCP with the bundled Chromium (11729b2)
- fix(cli): show a core command's usage for `<command> --help` (c1845b2)
- fix(nuxt4): format templates with the generated project's ESLint config (27d1e7d)
- fix(ci): install the lefthook git hooks from a prepare script (8ddd0aa)
- feat(docs): keep the generated AGENTS.md an index (90aede9)
- perf(db): index every foreign key in the scaffold's schema (0b6d6e8)
- fix(docker): pin the base image by digest and drop npm from the runtime stage (3eb5180)
- fix(user-admin): drop outstanding reset links on an email or password change (29cfcfa)
- fix(nuxt4): pin generated projects to TypeScript 6 (295bbc8)
- fix(nuxt4): address review on user form validation (943d0b6)
- fix(nuxt4): explain and validate email and password requirements (ce0c0c6)
- fix(core): preserve explicitly owned obsolete template files (85ca934)
- fix(admin): type async-data fetch responses explicitly (dddd0ac)
- fix(mastra): bump past current main feature version (2afd8c2)
- fix(mastra): type admin fetch responses to avoid recursive route inference (f6d2aff)
- fix(auth-2fa): type fetch responses to avoid recursive Nuxt route inference (eac4964)
- fix(docs): bump writer for release workflow documentation update (b30dd65)
- fix(mastra): turn Mastra's PostHog telemetry off by default (f7d6371)
- chore(deps): bump vite from 8.3.1 to 8.3.2 (178a01c)
- fix(docker): pin pnpm to a major in the generated Dockerfile (361ead2)
- fix(release): pass when a retried POST finds the release already created (cd2c879)
- fix(core): keep the recorded project name inside a git worktree (2bfd5c6)
- docs(readme): cover plugin outdated, update and auto-update (68f6f65)
- docs(readme): rewrite in plain language and add a quick start section (cd08363)
- docs(readme): add npm, CI, node and license badges; list all six packages (b65becf)
- fix(release): keep the token out of argv and report every publish failure (6a677d3)
- fix(release): survive old curl and transient API errors when publishing (fe54c02)
- fix(release): publish the release through the REST API, not the gh CLI (a5c2799)
- fix(docs): say what pull really does to an edited file (0c78ea1)
- fix(core): run `skills add` with git and ssh unable to prompt (d7eded3)
- chore(deps): bump the dev-tooling group across 1 directory with 2 updates (b203217)
- feat(cli): plugin update, outdated and an auto-update policy (8b5d5f9)
- chore(deps): bump vite from 8.3.0 to 8.3.1 (5396f15)

[Full changelog](https://github.com/SevenLabnl/battlestack/compare/v1.3.0...v1.4.0)

## v1.3.0 (2026-09-24)

- fix(release): count only plain tags, see lightweight ones, keep branch names out of the script (3832a58)
- chore: rebump after rebasing onto #25 (ce31cbc)
- fix(landing-shell): keep the layout comment inside the template root (fed8068)
- feat(build-info): report the running version and commit in the app (61d100a)
- chore: bump chat, mastra and docs past the versions #25 took (1763cae)
- fix(chat): one system prompt per call, and authenticate the WebSocket route (551d4de)
- fix(storage): address in-network S3 endpoints path-style (12cd143)
- feat: hold new releases for a fixed 3 days, drop the release-age ramp (2d43e85)
- chore: drop the changelog comments above feature versions (1f55465)
- fix: make scaling replicas up and down safe, not just running them (3cb06b1)
- chore: bump nuxt4:docs to 1.0.21 after a version collision with main (63d31d3)
- fix: address code review on the replica-safety work (a7c9a23)
- feat: make the scaffold safe on multiple replicas (40d188f)
- chore(deps): bump the dev-tooling group with 2 updates (e35bba3)
- fix(pull): stop reporting an unloaded plugin's feature as removed upstream (4dda34f)
- fix(cli): surface a plugin that failed to load, on every command (9e93d12)
- fix(mastra): cast the gateway model past Mastra's stale vendored provider types (7c10537)
- chore: ignore the local .build cache directory (fc286ae)
- test(core): cover all three extension branches advertising into the catalog (06a3825)
- fix(theme): add publish metadata and keep company logos out of the tarball (09a7011)
- feat(core): advertise template-extension features in the framework catalog (fe5439a)
- feat(theme): make @battlestack/theme publishable (ea1b21c)
- chore(deps): bump magicast from 0.5.4 to 0.5.5 (509b11c)
- chore(deps): bump @types/node in the dev-tooling group (8afa476)
- fix: address second review round on PR #12 (a2c22b7)
- fix: stop pull from silently clobbering files shared across features (5c80867)
- fix: Windows rel-path handling + phantom h3 dependency in scaffolds (948bf20)
- fix: address PR #12 review findings (3544628)
- feat: Battlestack design system as a Nuxt UI theme layer (2d297a8)

[Full changelog](https://github.com/SevenLabnl/battlestack/compare/v1.2.0...v1.3.0)

## v1.2.0 (2026-09-15)

- fix(gitignore): don't emit a double comma when topping up a reflowed block (8bccb9a)
- chore: rebump the three features #35 and #37 took to the same versions (9304a0f)
- fix(gitignore): ignore `.claude/**` so scoped skill content is not linted (e88ceac)
- fix(core): scope `skills add` to the configured agent, non-interactively (4323a9e)
- fix(core): run `skills add` non-interactively (630c6c9)
- fix: ignore .claude in eslint, gate dependency review, name a missing pm (c0270a8)
- docs: narrow README to a pointer, explain the @tiptap peers (d7f9581)
- docs(agents): correct the deploy claim, drop a private-plugin filename (9ed593d)
- docs(agents): close the AGENTS.md gaps a first external scaffold hit (934ba0b)
- fix(docker): resolve npm-aliased deps in the built image, guard the rest (d1f8f1d)
- chore(deps): bump the dev-tooling group across 1 directory with 3 updates (a09f51c)
- fix(core): probe both loopback families before calling a port free (702ec64)
- fix(preflight): gate the pm the scaffold uses, and state the pnpm floor (dace016)
- fix(preflight): fail on pnpm below the supported minimum (2bfa2e6)

[Full changelog](https://github.com/SevenLabnl/battlestack/compare/v1.1.0...v1.2.0)

## v1.1.0 (2026-09-08)

- core: addDefaultEnabledOptional on extendTemplate (#31) (e94eed5)
- docs: update PRD link in docs README (a79a501)
- docs: rename prd.md to PRD.md (a2183e4)

[Full changelog](https://github.com/SevenLabnl/battlestack/compare/v1.0.0...v1.1.0)

## v1.0.0 (2026-09-01)

- revert(icons): restore the original apple-touch-icon bytes (3a31a3f)
- fix(icons): make the icon pack actually reach existing projects (12ab48c)
- ci: make CI a required merge gate for main (20457d9)
- chore(deps): bump the dev-tooling group across 1 directory with 4 updates (5ebe19d)
- fix: drop baseUrl so the workspace type-check survives TypeScript 7 (31d2007)
- chore(deps): bump ora from 8.2.0 to 9.4.1 (10d8aa8)
- fix(icons): match the platform separator in structuralFiles() (1ec0a46)
- chore(deps): bump magicast from 0.5.3 to 0.5.4 (a129a28)
- ci: bump actions/setup-node from 6 to 7 (7842b38)
- ci: bump actions/upload-artifact from 4 to 7 (70e8d34)
- feat(icons): ship the battlestack icon pack as the scaffold default (27a5930)
- fix(core): keep binary template assets intact on the pull path (cff4b38)
- chore: take SonarQube out of the public preset (5e1f288)
- docs: add a product requirements document (7460482)
- docs: use security@sevenlab.ai so every contact address shares one domain (0a617d1)
- docs: add a user-facing documentation set and GitHub community files (76b09f7)

[Full changelog](https://github.com/SevenLabnl/battlestack/compare/v0.9.0...v1.0.0)

## v0.9.0 (2026-08-31)

- fix(health): readiness gates only on applicable config, in both variants (22e6916)
- fix: address the review findings — fail-closed gates, dry-run steady state, bounded docker writes (49baf03)
- chore: fixed the CI from running twice (d48f525)
- fix: bound the docker probes in detectStale, and stop the test spawning (08793b5)
- fix: keep dry runs out of the release environment, gate latest on promote (068ac42)
- fix: quote the release inputs and fail the bump step loudly (e59b4e5)
- fix: harden the version script against bad operator input (c8d5a4b)
- test: stop spawning real docker from the db unit tests (f9ed406)
- feat(health): split probe endpoints — /api/health/live and /api/health/ready (8d0230d)
- docs: scope the v0.1.0 changelog stanza to what 0.1.0 actually shipped (71d2ac0)
- ci: manual-approval releases, lockstep versions, production branch (c2e7d92)
- fix: make --dry-run write nothing during create (12ce8fa)
- fix: resolve plugin command dispatch by token, fqid and dry-run intent (0aa5316)
- fix: dispatch plugin commands through one shared code path in both modes (23fa619)
- cli: plugin-contributed commands work inside project mode (54a0172)
- fix: apply review findings and gate feature version bumps in CI (da02c6b)
- fix: resolve the database feature via enabledHas in generateInitialMigration (01225a8)
- feat: generate the initial drizzle migration at scaffold time (92cb764)
- fix: apply server/database/extensions in every migrate path, not just dev db:push (3667067)
- chore: drop every openai/gpt-4o-mini reference (a9ca404)
- fix: point the chat fallback at an id the catalogue actually serves (49dda58)
- fix: reach for the sluis alias only when the gateway is sluis (0d7ae06)
- refactor: preset-driven gateway defaults, not a provider-named constant (e44cf8e)
- fix: satisfy generated-project typecheck in icon-ssr-fetch plugin (2f49a6e)
- fix: restore SSR icon loading and make test-runner 503-aware (5cd0ea8)
- feat: default chat model to sluis/chat alias, prompt custom gateways (5949b0b)
- ci: publish via npm Trusted Publishing (OIDC) instead of a token (c6a4cb2)

## v0.1.0 (2026-08-13)

- feat: split the CLI into @battlestack/cli plus an unscoped npx wrapper (fcfb034)
- test: reword doctor test fixture flagged by leak-guard (92d3761)
- fix: satisfy generated-project lint in gateway template (2fefd41)
- refactor: address review — drop legacy fallbacks, harden gateway config (6f681cd)
- feat: generic OpenAI-compatible AI gateway with sluis.ai preset (2842d9e)
- docs: add installing and updating section to README (1a3aef4)
- docs: fill README content gaps — why, capabilities, components, authorship (cb49ea6)
- Initial commit (c5c3486)
