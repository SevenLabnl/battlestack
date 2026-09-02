# Architecture and token contract

Hierarchy: `Nuxt UI components → @battlestack/theme (tokens, alias map, BsLogo) → project (screens, brand.css, app.config ui defaults) → client theme (token re-values only)`. Screens are instances of the system, never a source of one-off styling.

## Where things live

- **Nuxt UI** — every component: markup, behaviour, keyboard, ARIA, states. Nothing here is ours to edit.
- **`@battlestack/theme`** (Nuxt layer, via `extends`) — `tokens.css` (Tailwind `@theme` ramps + `--ui-*` values, imported in `main.css` after `@import "@nuxt/ui"`), brand assets, `<BsLogo>`.
- **Project** — `app/assets/css/brand.css` (user-owned token re-values), `app/app.config.ts` (`ui.colors` alias map + component defaults), screens.
- **Client theme** — a theme-layer copy with different values. Same names, same shape; `check:contract` enforces it.

## Token model

`@theme` ramps (primitive) → Nuxt UI `--ui-*` variables (semantic) → semantic utility classes (consumed). Screens use only the utilities; `brand.css` and themes touch only documented names.

### The token set

- Aliases (in `ui.colors`): `primary → brand`, `secondary → lilac`, `neutral → stone`, plus `success/info/warning/error` on Tailwind ramps.
- Ramps: `--color-brand-50…950` (signal blue), `--color-lilac-50…950`, `--color-stone-50…950` (warm stone, overrides Tailwind's stone). Full 50–950 always — Nuxt UI requires every shade of an aliased palette.
- Surfaces: `--ui-bg` (white / warm near-black `#141311`), `--ui-bg-muted` (stone-50 canvas), `--ui-bg-elevated`, `--ui-bg-accented`, `--ui-bg-inverted`
- Text: `--ui-text-highlighted`, `--ui-text`, `--ui-text-toned`, `--ui-text-muted`, `--ui-text-dimmed`, `--ui-text-inverted`
- Borders: `--ui-border`, `--ui-border-muted`, `--ui-border-accented`, `--ui-border-inverted`
- Semantic: `--ui-primary` (brand-500 light / brand-400 dark), `--ui-secondary`, `--ui-success`, `--ui-info`, `--ui-warning`, `--ui-error` (+ generated `--ui-color-<alias>-<shade>` ramps)
- Shape/layout: `--ui-radius` (0.4375rem base; `rounded-md` ≈ controls, `rounded-lg` ≈ cards, `rounded-xl` ≈ dialogs), `--ui-container`, `--ui-header-height`
- Type: `--font-sans` Plus Jakarta Sans, `--font-mono` JetBrains Mono (self-hosted by `@nuxt/fonts`)

Reference: https://ui.nuxt.com/docs/getting-started/theme/design-system and https://ui.nuxt.com/docs/getting-started/theme/css-variables

## Visual direction ("Warm Modern Fintech")

Warm stone canvas (`bg-muted`) under white cards; one signal blue accent (white text on fills in light, ink text on lifted blue in dark); generous radii; borders over shadows; Plus Jakarta Sans; sentence case; numbers and IDs in mono.

## Implementation notes

- Component defaults and slot-class tweaks go in `app.config.ts` under `ui` (per component, per variant) — that is configuration, not forking.
- The brand lockup is `<BsLogo>` (`:wordmark="false"` for the mark alone); `currentColor`, scaled by `font-size`.
- Copy: sentence case; buttons are verb + object; errors say what happened and what to do; no emoji or exclamation marks.
