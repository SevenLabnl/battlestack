---
name: subagent-driven-development
description: Parallel task execution with a two-stage review gate. Delegates work to subagents and reviews their output.
---

# Subagent-Driven Development

Use this skill when executing a plan with multiple independent tasks. You act as the orchestrator; subagents do the implementation, you review and integrate.

## Roles

- **Orchestrator** (you): Breaks work into units, dispatches, reviews, integrates
- **Subagents**: Implement individual tasks within defined boundaries

## Process

### 1. Prepare Work Units
From the plan, create a work unit for each parallelizable task:

```
Work Unit: <name>
Scope: <files to create/modify>
Input: <types, interfaces, schemas it depends on>
Output: <what it produces>
Verify: <specific test or check>
```

### 2. Dispatch Subagents
Assign each work unit to a subagent with clear instructions:
- The full work unit definition
- Relevant project context (stack, conventions, existing patterns)
- Explicit boundaries (what NOT to modify)

### 3. Two-Stage Review

**Stage 1: Spec Compliance**
For each subagent's output, check:
- Does it match the work unit's scope? (no extra files, no missing files)
- Does it follow the expected interface/contract?
- Does it pass its specific verification?

**Stage 2: Code Quality**
- Type safety (no `any`, proper null handling)
- Error handling (API routes return proper error responses)
- Convention compliance (matches project patterns)
- Test coverage (key paths have tests)

### 4. Integrate
1. Merge subagent outputs into the main branch
2. Resolve any type conflicts at the interface level
3. Run full test suite: `pnpm test`
4. Run lint: `pnpm run lint`
5. Fix any integration issues

### 5. Verify Integration
After all subagents are integrated:
- Run the full verification checklist from **verification-before-completion**
- Check that the combined output satisfies the original plan

## Anti-Patterns
- Do not let subagents define shared types; define them first, then dispatch
- Do not skip Stage 1 review (spec compliance catches scope creep)
- Do not integrate without running tests; subagent work may conflict silently
- Do not dispatch tasks with shared mutable state to different subagents
