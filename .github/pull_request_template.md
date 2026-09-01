## What this changes

<!-- One or two sentences. What is different after this merges? -->

## Why

<!-- The problem, not the solution. If it fixes an issue, link it: Fixes #123 -->

## Type of change

- [ ] Bug fix
- [ ] New feature or template
- [ ] Refactor with no behaviour change
- [ ] Documentation
- [ ] Build, CI or release tooling

## AI assistance

Asked for context, not judgement. Agent-assisted PRs are welcome here; knowing
one was involved just tells a reviewer where to look harder, and helps us see
which tools work well against this codebase.

- [ ] No AI agent involved
- [ ] Claude Code
- [ ] Cursor
- [ ] GitHub Copilot
- [ ] Codex
- [ ] Other, named below

Agent, service and model, if you know it:

<!-- e.g. "Claude Code, Opus 5" or "Cursor, agent mode" -->

How much of this is agent-written?

- [ ] Whole change, reviewed by me before opening
- [ ] Substantial parts, with my own edits on top
- [ ] Small parts, or just the tests or docs
- [ ] Only the commit message or this description

Either way, you are the author: you are saying you understand the diff and stand
behind it. If an agent produced something you have not verified, say so here
rather than letting a reviewer discover it.

## Feature versions

Skip this section if you did not touch `packages/*/src/features/**` or
`packages/*/templates/**`.

A feature's `version` is how `battlestack pull` detects that an existing project
has something to apply. Without a bump, your change reaches new scaffolds and no
existing project, which is the most confusing possible outcome.

- [ ] I changed what a feature emits, and bumped that feature's `version`
- [ ] I changed a `collectDocs` or `collectEnv` contribution, and **also** bumped
      the feature that writes the target file (`nuxt4:docs` for
      `AGENTS.md`/`README.md`/`CLAUDE.md`, `shared:env` for `.env`)
- [ ] Not applicable

CI gates this, so an unbumped feature fails the run before anything else.

## Testing

<!--
What did you actually run? Paste the commands.
For a scaffold-affecting change, say which template you scaffolded and whether
you got as far as `battlestack dev` or `battlestack build`.
-->

```
pnpm tsc
pnpm test
```

Every assertion should survive one question: **if I delete the behaviour this
checks, does this test go red?** See
[CONTRIBUTING.md](../CONTRIBUTING.md#testing-a-test-must-be-able-to-fail).

- [ ] `pnpm tsc` passes
- [ ] `pnpm test` passes
- [ ] I removed the behaviour each new assertion covers, watched the test fail,
      and put it back

## Checklist

- [ ] Scoped to one concern. Unrelated cleanups are in their own commit or PR
- [ ] Public-facing docs updated where behaviour changed (`docs/`, `README.md`)
- [ ] No internal tracker numbers, post-mortem narrative, or internal
      infrastructure details in the diff
- [ ] Files under `packages/*/templates/**` are LF (`.gitattributes` enforces it;
      the copy path never translates line endings)
- [ ] No secrets, tokens or real credentials, including in test fixtures

## Anything else

<!-- Trade-offs you made, things you deliberately left out, known limits.
     Stating a limit plainly is better than having a reviewer find it. -->
