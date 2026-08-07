# Dispatching Parallel Agents

When work can be split into independent tasks:

**Good for parallel**: Independent API routes, client + server on different features, tests + implementation (interface defined), i18n for different pages, unrelated bug fixes.

**Bad for parallel**: Same-file modifications, dependent schema changes, features sharing active composables.

Process:
1. Identify independent work units (different files, no shared mutable state)
2. Define boundaries per agent: scope, context, verification, constraints
3. Use git worktrees for isolation when needed
4. After completion: review each output, integrate, run `pnpm test && pnpm run lint`

Nuxt parallel splits: Agent A (server: API + DB + seed), Agent B (client: pages + components), Agent C (tests), Agent D (config + i18n + types).

Never let two agents modify the same file. Always review output before integrating. Run full tests after integration.
