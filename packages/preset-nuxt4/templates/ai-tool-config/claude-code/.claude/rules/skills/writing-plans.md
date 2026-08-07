# Writing Plans

Break work into implementable tasks:

- Each task is **atomic** (one file or one logical change), **ordered** (dependencies top-to-bottom), and **verifiable** (clear done condition)
- Group tasks into phases: Foundation, Implementation, Integration, Polish
- Each task lists: files affected + verification command
- Insert **CHECKPOINT** markers where human review is needed (after schema changes, API contracts, UI wireframes)
- Task sizing: schema change = 1 task, API route = 1 task, page component = 1 task, composable = 1 task
- Save the plan to `docs/plans/` or project root
