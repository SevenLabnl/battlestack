# @battlestack/theme

Battlestack Design System Nuxt as a Nuxt layer. **No components** — Nuxt UI is
the component library; this package themes it and nothing else.

Source of truth: the "Battlestack Design System Nuxt" project on
claude.ai/design. Values change there first and are mirrored here.

## What it ships

- `tokens.css` — Tailwind `@theme` ramps (brand / lilac / warm-stone) and the
  `--ui-*` values for light and dark. Imported from the project's
  `app/assets/css/main.css` (after `@import "@nuxt/ui"`), because `@theme` must
  compile inside the project's Tailwind root.
- `<BsLogo>` — the Battlestack lockup, the layer's only component (brand, not UI).
- Brand SVG assets (`assets/`).
- Gates: `check:contrast` (WCAG pairs through the real `var()` chains, both
  modes) and `check:contract` (full ramps only, documented `--ui-*` names only,
  every `:root` override restated in `.dark`).

## How a project consumes it

`nuxt4:battlestack-theme` (in `@battlestack/preset-nuxt4`) wires it up:
`extends: ['@battlestack/theme']`, the two `@import`s in `main.css`, the
semantic alias map (`primary: 'brand'`, `secondary: 'lilac'`,
`neutral: 'stone'`) in `app.config.ts`, and a project-owned
`app/assets/css/brand.css` for local token overrides.

A client theme is a copy of this package with different values — same names,
same shape, `check:contract` enforces it.
