---
name: brainstorming
description: Explore ideas and approaches before writing code. Used when facing architectural decisions or new features.
---

# Brainstorming

Use this skill when you need to explore ideas before committing to an implementation. Brainstorming produces a design document, not code.

## When to Brainstorm

- New features that touch multiple files or systems
- Architectural decisions (new API routes, database schema changes, state management)
- When the task-arbiter sends you here via "PLAN FIRST"
- When the user explicitly asks to brainstorm

## Process

### 1. Frame the Problem
Write a clear problem statement in 1-2 sentences. Include:
- What needs to change
- Why it needs to change
- Who is affected (user-facing vs internal)

### 2. List Constraints
Identify hard constraints from the project stack:
- **Nuxt SSR (universal)**: code runs on server + client; guard browser-only APIs with `import.meta.client`
- **Drizzle ORM**: schema changes require migrations (`pnpm run db:generate`)
- **Nuxt UI v4**: use existing components before building custom ones
- **i18n**: all user-facing text needs NL and EN translations
- **vitest**: tests must pass with 2-minute timeout
- **LiteLLM proxy**: AI calls go through the gateway URL configured in `NUXT_LITELLM_URL` (set at scaffold time; see this project's `.env`)

### 3. Generate Options
Produce 2-3 distinct approaches. For each:
- **Approach name** (one line)
- **How it works** (3-5 bullet points)
- **Pros** (what makes this good)
- **Cons** (what makes this risky or complex)
- **Files affected** (list specific paths)

### 4. Recommend
Pick the best approach and explain why in 2-3 sentences. Highlight the key tradeoff.

### 5. Write Design Spec
Save the brainstorm output to `docs/specs/<date>-<feature-name>.md` with sections:
- Problem statement
- Constraints
- Options considered
- Recommendation
- File impact list

## Output

The brainstorm is complete when you have a design spec saved to disk. Do not write any implementation code during brainstorming.

Transition to the **writing-plans** skill to break the recommendation into executable tasks.
