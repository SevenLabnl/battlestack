# Theming and accessibility

## Themes

Light and dark are equal themes on the same semantic token names: light on `:root`, dark on `[data-theme="dark"]`. Express theme differences by substituting token values — never `if dark` conditionals, never duplicate components (`CardDark`).

Dark mode is not an inversion. Verify: surface hierarchy, border visibility, text/muted/icon contrast, overlay distinction, input boundaries, focus ring, status colors, disabled vs enabled. No pure black unless the theme calls for it.

## Client theming

A client is themed by overriding tokens in the client theme package — in order of likelihood:

1. Accent scale + semantic accent mappings (`--primary*`, `--link`, `--focus`, `--chart-*`)
2. Neutral tint (`--gray-*`) and surfaces
3. Typography (`--font-sans/mono` + font loading)
4. Radius scale and shadows
5. Nav chrome (`--nav-*`: ink vs light)
6. Brand assets (logo)

Structure, behaviour, states, and APIs stay identical across clients.

**Contrast gate after any color change, in both themes.** This is automated —
run `pnpm check:ds`, which resolves every `var()` chain the way a browser would and
checks each pair in light and dark. It fails the build; do not weaken it to pass.
What it holds:

- `--primary` with `--primary-fg` ≥ 4.5:1 (accents too light for white text pair with an ink foreground instead — the split may flip per theme);
- accent used *as text* (`--link`, status text) ≥ 4.5:1 on `--bg` and `--surface`;
- `--border-strong` and `--focus` ≥ 3:1 non-text contrast;
- passing in the default theme is not sufficient — point the gate at the client theme too.

The same command runs the **contract** gate (a theme may change token values, never add or drop a name) and the **layer** gate (no primitives, raw hex or raw px in a component).

## Accessibility baseline (WCAG 2.2 AA)

**Structure** — native semantic HTML; buttons for actions, links for navigation; visible labels associated with controls; heading hierarchy; accessible names on icon-only controls.

**Keyboard** — everything operable; predictable tab order; expected composite-widget behaviour; focus managed in dialogs/drawers/menus/popovers and returned on dismiss.

**Focus** — clearly visible `focus-visible` (2px `--focus`, 2px offset); never removed without an accessible equivalent; works on light and dark surfaces.

**Contrast** — 4.5:1 normal text, 3:1 large text and essential non-text (boundaries, states, focus).

**Targets** — meet WCAG 2.2 target size; no tiny icon-only targets without clickable padding (controls ≥32px).

**Errors & status** — never color alone: pair with text/icon/position; wire validation via `aria-describedby`/`aria-invalid`; announce important async changes (`role="alert"`/`"status"`).

**Motion** — respect `prefers-reduced-motion`; no motion required to understand functionality.

**Disabled & loading** — distinct but readable disabled states; prevent duplicate submissions; keep an accessible label/state while loading.

## Review trigger

Do an explicit accessibility pass whenever work touches: forms, navigation, dialogs/drawers, menus/popovers, keyboard or focus behaviour, colors/themes, status messaging, drag/drop, custom widgets, or animation.
