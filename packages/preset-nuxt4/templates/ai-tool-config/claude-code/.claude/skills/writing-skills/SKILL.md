---
name: writing-skills
description: Create and test new custom skills for this project's skills plugin.
---

# Writing Skills

Use this skill when you need to create a new custom skill for the project's skills plugin.

## Skill Structure

Every skill lives in its own directory under `.claude/skills/`:

```
skills/<skill-name>/
└── SKILL.md
```

### SKILL.md Format

```markdown
---
name: <skill-name>
description: <One sentence describing when and why to use this skill.>
---

# <Skill Title>

<1-2 sentences on when to activate this skill.>

## When to Use
<Bullet list of trigger conditions>

## Process
<Numbered steps with clear actions>

## Rules
<Bullet list of hard constraints>
```

## Design Principles

### 1. Single Responsibility
Each skill should do one thing well. If a skill has two distinct phases, consider splitting it into two skills with a transition.

### 2. Actionable Steps
Every step should be something the AI can execute, not a vague instruction. Bad: "Think about the architecture." Good: "List the files that will be affected and their dependencies."

### 3. Stack Awareness
Reference the project stack specifically:
- Use `pnpm test` not "run tests"
- Use `pnpm run db:generate` not "create a migration"
- Use `Nuxt UI v4 components` not "UI components"

### 4. Verifiable Outcomes
Each skill should produce something concrete:
- A file on disk (design doc, plan, test)
- A passing test
- A verified browser state

### 5. Transition Points
End each skill by naming the next skill to use, when applicable.

## Testing a New Skill

1. Create the SKILL.md file
2. Start a new conversation
3. Describe a scenario that should trigger the skill
4. Verify the skill activates and produces the expected output
5. Iterate on the wording until the behavior is reliable

## Registering the Skill

For Claude Code, simply creating the file in the skills directory is sufficient; the plugin system discovers it automatically.

For other AI tools (Gemini, Cursor, Codex), also create a distilled rules file at `.gemini/rules/<skill-name>.md` (or the equivalent for the tool).

## Rules
- Keep skills under 200 lines; concise is better
- Use markdown formatting for structure (headers, lists, code blocks)
- Test the skill before committing it
- Document the trigger conditions clearly in the description
