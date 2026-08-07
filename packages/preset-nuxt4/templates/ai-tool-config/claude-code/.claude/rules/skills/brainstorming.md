# Brainstorming

When facing architectural decisions or new features, brainstorm before coding:

1. **Frame the problem** in 1-2 sentences (what, why, who)
2. **List constraints**: Nuxt SSR (universal: guard browser APIs with `import.meta.client`), Drizzle ORM (migrations required), Nuxt UI v4 (use before custom), i18n (NL + EN), vitest (2-min timeout), LiteLLM proxy
3. **Generate 2-3 options** with pros, cons, and files affected
4. **Recommend** the best approach with reasoning
5. **Save** the design spec to `docs/specs/<date>-<feature>.md`

Do not write implementation code during brainstorming. Transition to planning after the spec is written.
