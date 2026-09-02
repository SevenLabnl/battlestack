---
name: battlestack-ui
description: Apply the Battlestack design system when building, modifying, reviewing, or refactoring frontend UI. Use for page implementation, component work, styling, light/dark theming, client themes, accessibility reviews, and any request that could introduce new UI components, variants, tokens, or patterns. Enforces Nuxt UI as the only component library, semantic design tokens, WCAG 2.2 AA, and the rule that branding lives in tokens only.
---

# Battlestack UI

**Nuxt UI is the component library.** The design system is a theme on top of it — the `@battlestack/theme` Nuxt layer — never a parallel component set. Building a custom UI component is the one move that is almost always wrong.

`DESIGN_SYSTEM.md` in the repo root is the binding authority; this skill is the working procedure.

## Workflow

### 1. Inspect before changing

- Read `DESIGN_SYSTEM.md`, `app/app.config.ts` (the `ui` key), `app/assets/css/main.css` and `app/assets/css/brand.css` before proposing anything.
- Find the Nuxt UI component first: https://ui.nuxt.com/docs/components covers layout, forms, tables, overlays, navigation, dashboard shells, chat, auth, pricing and marketing pages. Never assume a gap without checking.

### 2. Classify the change — pick the earliest valid option

1. Use an existing Nuxt UI component.
2. Compose Nuxt UI components (`UCard + UBadge + UButton`) in the app layer.
3. Use component props (`variant`, `color`, `size`, `orientation`, …).
4. Configure via the `ui` prop / slot classes on the instance.
5. Set a project-wide default in `app.config.ts` under `ui`.
6. Re-value a token (`brand.css` for this project; the theme layer for all projects).
7. *Only then*: raise a design-system gap. Never a local lookalike component.

State the classification in one line before implementing. For 6–7, read `references/component-selection.md`.

### 3. Implement with tokens

- Semantic utilities only in screens: `text-muted`, `bg-elevated`, `border-default`, `text-primary`, `rounded-md` — never raw hex, arbitrary px, or Tailwind palette classes (`text-blue-600`) where a semantic name exists.
- Token names come from Nuxt UI (`--ui-*`) and the theme's ramps; never invent a name. Contract and token list: `references/design-system.md`.
- Dark mode is the `.dark` class: any `:root` token override needs its `.dark` restatement.

### 4. Validate

Run repo lint/typecheck/tests when available. For work touching colors, themes, forms, overlays, keyboard, or motion: `references/theming-accessibility.md`. Before finishing: `references/review-checklist.md`.

## Guardrails — never

- Create a custom component (or wrapper whose only job is styling) when Nuxt UI has the component or the composition.
- Hardcode brand values in screens; put client logic in shared theme code.
- Create dark/light duplicate implementations.
- Remove visible focus styling; communicate status via color alone; trade accessibility for visual fidelity.

## Sanctioned exceptions

Exactly two, listed in `DESIGN_SYSTEM.md`: charts (no Nuxt UI equivalent — use the per-project chart library, themed with `--ui-color-*`) and complex date entry (`@vuepic/vue-datepicker`). Neither is a precedent.
