---
name: dispatching-parallel-agents
description: Coordinate concurrent subagent work for independent tasks. Split work across agents safely.
---

# Dispatching Parallel Agents

Use this skill when work can be split into independent tasks that run concurrently. Parallelism saves time but requires careful coordination.

## When to Parallelize

Good candidates for parallel work:
- **Independent API routes** that do not share schema changes
- **Client + server** work on different features
- **Tests + implementation** when the interface is already defined
- **i18n translations** for different pages
- **Multiple bug fixes** in unrelated files

Bad candidates (do sequentially):
- Tasks that modify the same files
- Database schema changes that depend on each other
- Features that share state or composables being actively changed

## Process

### 1. Identify Independent Work Units
From the plan, identify tasks that:
- Touch different files
- Do not share mutable state
- Can be verified independently

### 2. Define Agent Boundaries
For each parallel agent, specify:
- **Scope**: Exactly which files it may create or modify
- **Context**: What it needs to know about the project state
- **Verification**: How to confirm its work is correct
- **Constraints**: What it must NOT touch

### 3. Dispatch

Use git worktrees for isolation when agents modify overlapping areas:
```bash
git worktree add ../project-feature-a -b feature-a
git worktree add ../project-feature-b -b feature-b
```

For non-overlapping work, agents can work in the same tree on different files.

### 4. Review and Integrate
After all agents complete:
1. Review each agent's output individually
2. Run `pnpm test` on the integrated result
3. Resolve any conflicts
4. Run full verification: `pnpm test && pnpm run lint`

## Nuxt-Specific Parallelism

Common parallel splits for Nuxt projects:
- **Agent A**: Server-side (API routes, database schema, seed data)
- **Agent B**: Client-side (pages, components, composables)
- **Agent C**: Tests (unit tests, integration tests)
- **Agent D**: Infrastructure (config, i18n, types)

## Rules
- Never let two agents modify the same file
- Always review agent output before integrating
- If agents produce conflicting types, resolve in the type definition file first
- Run full tests after integration, even if each agent's work passed individually
