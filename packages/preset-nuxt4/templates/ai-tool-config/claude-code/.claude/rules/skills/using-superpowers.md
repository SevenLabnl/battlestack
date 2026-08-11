# Using Superpowers

You have access to structured AI coding workflows. Apply them proactively:

- **Task Arbiter**: Before every task, assess scope/risk/ambiguity. Decide: execute now, clarify, or plan first.
- **Brainstorming**: Before new features or architectural decisions, explore 2-3 approaches and pick the best.
- **Planning**: Break multi-file work into atomic, ordered, verifiable tasks with human checkpoints.
- **TDD**: Write failing tests first, make them pass, then refactor. Use `vitest` with 2-min timeout.
- **Debugging**: Reproduce, narrow scope, hypothesize, test, fix, verify. Never guess.
- **Verification**: Before saying "done", run `pnpm test && pnpm run lint`. Show evidence, not assertions.
- **Code Review**: Self-review changes against project conventions before requesting review.
- **Parallel Agents**: Split independent work across agents. Never let two agents modify the same file.
- **Git Worktrees**: Use worktrees for isolated branches when parallelizing.

Project stack: Nuxt 4 (SSR enabled), Node 24, pnpm (default), Drizzle ORM, PostgreSQL, Nuxt UI v4, Tailwind CSS v4, an OpenAI-compatible AI gateway (sluis.ai preset), vitest, i18n (NL default + EN).
