---
name: task-arbiter
description: Triage every incoming task before taking action. Decides whether to execute immediately, ask for clarification, or plan first.
---

# Task Arbiter

This skill runs before every task. It prevents over-engineering simple changes and under-planning complex ones.

## Decision Process

When you receive a new task, assess these four dimensions:

### 1. Scope
How many files and systems are affected?
- **Narrow**: 1-2 files in one directory
- **Medium**: 3-5 files across related directories
- **Wide**: 6+ files, multiple systems (DB + API + UI)

### 2. Risk
Could this break existing functionality?
- **Low**: Additive changes, new files, config tweaks
- **Medium**: Modifying existing logic, changing API responses
- **High**: Database schema changes, auth modifications, shared utility changes

### 3. Ambiguity
Is the request clear?
- **Clear**: Specific file, specific change, specific behavior
- **Partially clear**: Goal is clear but approach is not
- **Ambiguous**: Multiple valid interpretations

### 4. Dependencies
Does this touch shared interfaces or data models?
- **None**: Self-contained change
- **Some**: Uses shared types but does not change them
- **Heavy**: Changes shared interfaces, schemas, or contracts

## Decision Matrix

| Scope | Risk | Ambiguity | Dependencies | Decision |
|---|---|---|---|---|
| Narrow | Low | Clear | None | **EXECUTE NOW** |
| Narrow | Low | Clear | Some | **EXECUTE NOW** |
| Narrow | Medium | Clear | None | **EXECUTE NOW** |
| Any | Any | Ambiguous | Any | **CLARIFY FIRST** |
| Any | Any | Partially clear | Heavy | **CLARIFY FIRST** |
| Medium+ | Medium+ | Any | Any | **PLAN FIRST** |
| Wide | Any | Any | Any | **PLAN FIRST** |
| Any | High | Any | Any | **PLAN FIRST** |

### EXECUTE NOW
Proceed directly. No planning phase needed.
- Single-file changes
- Bug fixes with clear root cause
- Additions to existing patterns (new API route following existing pattern)
- Config changes
- Test additions

### CLARIFY FIRST
Ask 1-2 targeted questions before deciding.
- "Do you want X or Y?"
- "Should this affect existing records or only new ones?"
Do not ask open-ended questions. Be specific.

### PLAN FIRST
Invoke the **brainstorming** and **writing-plans** skill chain.
- Multi-file features
- Database schema changes
- New architectural patterns
- Anything touching auth, API contracts, or shared types

## Output Format

State your decision in one line with one sentence of reasoning:

> **EXECUTE NOW**: Single config change to nuxt.config.ts, no dependencies.

> **CLARIFY FIRST**: The request could mean updating the existing form or creating a new one. Which do you mean?

> **PLAN FIRST**: This adds a new entity with DB schema, API routes, and a page. Planning needed.

Then immediately take the appropriate action (start coding, ask the question, or start brainstorming).
