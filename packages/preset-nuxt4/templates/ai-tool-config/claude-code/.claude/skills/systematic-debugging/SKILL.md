---
name: systematic-debugging
description: Root cause analysis methodology. Used when a bug's cause is not immediately obvious.
---

# Systematic Debugging

Use this skill when you encounter a bug that is not immediately obvious. Do not guess; investigate systematically.

## Process

### 1. Reproduce
Before anything else, confirm the bug is reproducible:
- Run the failing test or trigger the behavior
- Document the exact error message, stack trace, or unexpected output
- Note the environment (which file, which route, client vs server)

### 2. Narrow the Scope
Determine where the bug lives in the Nuxt server/client split:
- **Client-side** (app/ directory): Vue components, composables, stores, pages
- **Server-side** (server/ directory): API routes, database queries, auth utilities
- **Shared** (types, validation schemas): Used by both sides
- **Build/config** (nuxt.config.ts, drizzle.config.ts): Configuration issues

### 3. Form a Hypothesis
Based on the error and scope, write one sentence: "The bug is likely caused by ___."

Common root causes in this stack:
- **Drizzle schema mismatch**: Schema does not match database (run `pnpm run db:generate` + `pnpm run db:migrate`)
- **Missing env var**: Variable not in `.env` or not in `runtimeConfig`
- **Auth middleware**: Route not protected or incorrectly protected
- **WebSocket streaming**: Nitro WS handler at `/_ws` not registered, connection dropped, message not flushed, or upstream LiteLLM stream not consumed before close
- **i18n key missing**: Key exists in NL but not EN, or vice versa
- **Type mismatch**: Zod schema does not match TypeScript interface
- **Unresolved `#server/...` / `#imports` import or duplicate exports**: an import points at a path that does not exist, or two files export the same name. Nitro fails its build on an unresolvable import, so the server binds the port but never serves: looks like a hung startup. Check the import path resolves to a real file, and look for stray pull-merge artifacts (see below)
- **Stale `battlestack pull` merge artifacts**: pending merges live under `.battlestack/pull/` and must never sit beside source files. If you see a `*.battlestack.new` / `*.battlestack.patch` / `*.battlestack.bak` inside `server/` or `app/`, it is a leftover from an older pull; it shadows or duplicates the real module and breaks dev/build. Remove it (or run `battlestack cleanup`), then reconcile the real change from `.battlestack/pull/`

### 4. Test the Hypothesis
Make the smallest possible change that would confirm or deny your hypothesis:
- Add a `console.log` at the suspected failure point
- Check the database state with a raw query
- Verify the environment variable is set
- Run a specific test in isolation

### 5. Fix
Once confirmed, fix the root cause, not the symptom.

### 6. Verify
- Run the previously failing test to confirm it passes
- Run related tests to check for regressions
- Run `pnpm test && pnpm run lint` for full confidence

### 7. Document
If the bug was non-obvious, add a code comment explaining why the fix works. Future developers (including AI) should not have to re-discover this.

## Anti-Patterns
- Do not change multiple things at once; isolate variables
- Do not assume the first error message is the root cause; it may be a symptom
- Do not skip reproduction; "it works on my machine" is not verification
- Do not add workarounds without understanding the root cause
