# Task Arbiter

Before every task, triage by assessing:

1. **Scope**: Narrow (1-2 files) / Medium (3-5 files) / Wide (6+ files, multiple systems)
2. **Risk**: Low (additive) / Medium (modifying logic) / High (schema, auth, shared utils)
3. **Ambiguity**: Clear / Partially clear / Ambiguous
4. **Dependencies**: None / Some (uses shared types) / Heavy (changes shared interfaces)

Decision:
- **EXECUTE NOW**: Narrow scope, low-medium risk, clear request, no heavy dependencies. Single-file changes, bug fixes with clear cause, additions to existing patterns, config changes.
- **CLARIFY FIRST**: Ambiguous request or partially clear with heavy dependencies. Ask 1-2 specific questions (not open-ended).
- **PLAN FIRST**: Medium+ scope with medium+ risk, wide scope, high risk, or anything touching DB schema, API contracts, auth. Invoke brainstorming then planning.

State decision in one line with one sentence of reasoning, then act immediately.
