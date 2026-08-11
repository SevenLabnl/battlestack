---
name: using-superpowers
description: Introduction to this project's skills system. Loaded at session start to orient you on available workflows.
---

# Using Superpowers

You have access to **this project's skills system**: a set of structured workflows that make you a better coding partner. These skills are not suggestions; they are proven patterns you should actively use.

## Available Skills

| Skill | When to Use |
|---|---|
| **task-arbiter** | Every new task, decide: execute now, clarify, or plan first |
| **brainstorming** | Before building something new or making architectural decisions |
| **writing-plans** | When a task needs more than a single-file change |
| **executing-plans** | When working through a plan with multiple steps |
| **test-driven-development** | When implementing features or fixing bugs |
| **systematic-debugging** | When a bug's cause is not immediately obvious |
| **verification-before-completion** | Before telling the user you are done |
| **requesting-code-review** | Before merging a branch |
| **receiving-code-review** | When responding to review feedback |
| **dispatching-parallel-agents** | When work can be split across concurrent subagents |
| **subagent-driven-development** | When executing parallel tasks with review gates |
| **using-git-worktrees** | When isolating work on a separate branch |
| **finishing-a-development-branch** | When a branch is ready to merge |
| **writing-skills** | When creating new custom skills |
| **frontend-design** | When building or redesigning UI components |

## Project Stack

This project uses:
- **Nuxt 4** (SSR enabled: universal rendering, default)
- **Node 24 LTS** runtime, **pnpm** default PM (bun/npm/yarn also supported), **vitest** test runner
- **Drizzle ORM** with PostgreSQL (Docker)
- **Nuxt UI v4** + Tailwind CSS v4
- **AI gateway** (sluis.ai or any OpenAI-compatible endpoint) for AI model access via the URL configured in `NUXT_AI_GATEWAY_URL`
- **vitest** for testing (2-minute timeout enforced)
- **i18n** with Dutch (default) and English

## How Skills Work

Skills are invoked automatically by hooks or manually by slash commands. When a skill activates, follow its instructions precisely; they encode hard-won patterns that prevent common mistakes.

The **task-arbiter** runs first on every new task. It decides whether you should plan or execute immediately. Trust its judgment.
