# Subagent-Driven Development

When orchestrating parallel task execution:

1. **Prepare work units**: For each task define scope (files), input (types/schemas), output (deliverable), verify (specific check)
2. **Dispatch**: Assign each unit to a subagent with full project context and explicit boundaries
3. **Two-stage review**:
   - Stage 1 (spec compliance): Matches scope? Follows interface? Passes verification?
   - Stage 2 (code quality): Type safety, error handling, conventions, test coverage
4. **Integrate**: Merge outputs, resolve type conflicts at interface level, run `pnpm test && pnpm run lint`

Define shared types FIRST, then dispatch. Do not skip spec compliance review. Do not integrate without tests. Do not dispatch tasks with shared mutable state to different subagents.
