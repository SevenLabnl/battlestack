# Theming and accessibility

## Themes

Light and dark are equal themes on the same token names: light on `:root`, dark on `.dark` (Nuxt UI's convention, driven by the color-mode switcher). Express theme differences by substituting token values — never `if dark` conditionals, never duplicate components (`CardDark`).

Dark mode is not an inversion. Because theme declarations load after Nuxt UI's own `.dark` block, **every token set on `:root` must be restated in `.dark`** — an unrestated light value silently wins in dark mode. Verify: surface hierarchy, border visibility, text/muted/icon contrast, overlay distinction, input boundaries, focus ring, status colors, disabled vs enabled. No pure black.

## Client theming

A client is themed by re-valuing tokens — in order of likelihood:

1. Accent ramp + which shade carries `--ui-primary` per mode (and `ui.colors` aliases)
2. Neutral ramp (`--color-stone-*` replacement) and the `--ui-bg*`/`--ui-text*`/`--ui-border*` roles
3. Typography (`--font-sans`/`--font-mono` + `@nuxt/fonts` families)
4. Shape (`--ui-radius`) and layout (`--ui-container`, `--ui-header-height`)
5. Brand assets (logo)

Structure, behaviour, states, and component APIs stay identical across clients — they are Nuxt UI's.

**Contrast gate after any color change, in both themes** (`pnpm check:ds` runs this for the theme package):

- `--ui-primary` with its button text (`text-inverted`) ≥ 4.5:1 — accents too light for white text pair with an ink foreground instead; the split may flip per mode;
- accent used *as text* (`text-primary`, links) ≥ 4.5:1 on `--ui-bg` and `--ui-bg-muted`;
- `--ui-primary` and control borders ≥ 3:1 non-text contrast against their background;
- passing in the default theme is not sufficient — re-check the client theme.

## Accessibility baseline (WCAG 2.2 AA)

Nuxt UI ships the behaviour (Reka UI underneath: roles, keyboard, focus management). The job is not to break it:

**Structure** — native semantic HTML around the components; buttons for actions, links for navigation; visible labels via `UFormField`; heading hierarchy; accessible names on icon-only buttons (`aria-label`).

**Keyboard** — everything operable; predictable tab order; don't intercept keys the components handle; overlays return focus on dismiss (built in — keep it).

**Focus** — clearly visible `focus-visible` treatment (Nuxt UI's outline); never removed without an accessible equivalent; works on light and dark surfaces.

**Contrast** — 4.5:1 normal text, 3:1 large text and essential non-text (boundaries, states, focus).

**Errors & status** — never color alone: pair with text/icon/position; `UFormField`'s `error` wires `aria-describedby`/`aria-invalid`; announce important async changes (`role="alert"`/`"status"` — `UAlert`/toasts do this).

**Motion** — respect `prefers-reduced-motion`; no motion required to understand functionality.

**Targets** — meet WCAG 2.2 target size; no tiny icon-only targets without clickable padding.

## Review trigger

Do an explicit accessibility pass whenever work touches: forms, navigation, dialogs/slideovers, menus/popovers, keyboard or focus behaviour, colors/themes, status messaging, drag/drop, or animation.
