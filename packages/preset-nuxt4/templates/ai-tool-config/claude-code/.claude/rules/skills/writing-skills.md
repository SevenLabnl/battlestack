# Writing Skills

To create a new custom skill:

1. Create `skills/<skill-name>/SKILL.md` (for Claude Code) with frontmatter: `name`, `description`
2. Structure: When to Use (trigger conditions), Process (numbered actionable steps), Rules (hard constraints)
3. Each step must be executable, not vague. Say `pnpm test` not "run tests".
4. Skills should produce something concrete: a file, a passing test, a verified state
5. End with transition to the next skill when applicable
6. Keep under 200 lines. Test by triggering the skill in a new conversation.
7. For non-Claude tools, also add a distilled rules file to the rules directory.

Principles: single responsibility, actionable steps, stack-aware references, verifiable outcomes.
