---
name: writing-plans
description: Break work into implementable tasks with clear boundaries and verification criteria.
---

# Writing Plans

Use this skill to decompose a design spec or feature request into a concrete plan of executable tasks.

## When to Use

- After brainstorming produces a design spec
- When the task-arbiter says "PLAN FIRST"
- When the user asks you to plan before coding

## Plan Structure

Write the plan as a markdown checklist. Each task must be:

1. **Atomic**: completable in one focused session (usually one file or one logical change)
2. **Ordered**: dependencies flow top-to-bottom
3. **Verifiable**: has a clear done condition (test passes, file exists, behavior works)

### Template

```markdown
# Plan: <feature name>

## Context
<1-2 sentences from brainstorming recommendation>

## Tasks

### Phase 1: Foundation
- [ ] Task description
  - Files: `path/to/file.ts`
  - Verify: <how to confirm it works>

### Phase 2: Implementation
- [ ] Task description
  - Files: `path/to/file.ts`, `path/to/other.ts`
  - Verify: <test command or manual check>

### Phase 3: Integration
- [ ] Wire up components
  - Files: `app/pages/feature.vue`
  - Verify: `pnpm test` passes

### Phase 4: Polish
- [ ] Add i18n translations (NL + EN)
  - Files: `i18n/locales/nl.ts`, `i18n/locales/en.ts`
  - Verify: Switch language in UI
- [ ] Run full verification
  - Verify: `pnpm test && pnpm run lint`
```

## Task Granularity for Nuxt Projects

Follow these patterns for task sizing:
- **Database schema change** = one task (schema file + migration)
- **API route** = one task per route (handler + validation + test)
- **Page component** = one task per page (component + route + i18n keys)
- **Composable** = one task (composable + unit test)
- **Config change** = one task (nuxt.config.ts or app.config.ts)

## Human Checkpoints

Insert checkpoint markers where the user should review before continuing:

```markdown
- [ ] **CHECKPOINT: Review database schema before proceeding**
```

Place checkpoints after:
- Database schema changes (before writing migrations)
- API contract changes (before implementing clients)
- UI wireframe decisions (before building components)

## Output

Save the plan to the project root or `docs/plans/` directory. Then transition to the **executing-plans** skill.
