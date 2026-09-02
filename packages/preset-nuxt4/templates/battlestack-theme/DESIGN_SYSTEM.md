# Design system

This project uses **Battlestack Design System Nuxt**: Nuxt UI components themed with Battlestack tokens. This file is the authority for anything that renders. The design source of truth is the "Battlestack Design System Nuxt" project on claude.ai/design.

## Core rules

1. **Nuxt UI is the component library — use it for everything.**
   - Before writing any UI, find the Nuxt UI component (https://ui.nuxt.com/docs/components). It covers layout, forms, tables, overlays, navigation, dashboard shells, chat, auth, pricing and marketing pages.
   - Composition beats creation: `UCard + UBadge + UButton`, never a custom `CustomerStatusCard`.
   - **No custom components unless absolutely necessary.** A gap is a team decision, not a local fix. Order of escalation: existing component → composition → component props → `ui`/`class` slot config → `app.config.ts` default → *then* raise it as a design-system change.

2. **Configuring Nuxt UI components is allowed and encouraged.**
   - Props are the API: `<UProgress orientation="vertical" />`, `size`, `variant`, `color` — use them.
   - Project-wide defaults and slot classes go in `app/app.config.ts` under `ui` — e.g. changing every `UButton`'s default variant. That is configuration, not forking.

3. **Styling lives in tokens only.**
   - The theme layer (`@battlestack/theme`) values the tokens: Tailwind `@theme` ramps + Nuxt UI's `--ui-*` variables, plus the alias map in `app.config.ts` (`ui.colors`: `primary: 'brand'`, `secondary: 'lilac'`, `neutral: 'stone'`).
   - Project-level tuning goes in `app/assets/css/brand.css` (yours; `battlestack pull` never touches it). Re-value existing `--ui-*` names — never invent one.
   - In screens, use the semantic utilities Nuxt UI generates: `text-muted`, `bg-elevated`, `border-default`, `text-primary`, `rounded-md` — never raw hex, arbitrary px, or Tailwind palette classes (`text-blue-600`) when a semantic name exists.
   - Client branding = a client theme layer with different token values. Never client conditionals in components or screens.

4. **Both themes, always.** Dark mode is the `.dark` class; same token names, different values. Any `:root` token override needs its `.dark` counterpart (later declarations beat Nuxt UI's own `.dark` block). Check every screen in both modes.

5. **Accessibility (WCAG 2.2 AA).** Nuxt UI ships keyboard/ARIA behaviour — don't break it: keep visible focus (`focus-visible` outline), pair status color with text/icon, keep labels on form fields (`UFormField`), re-verify contrast after any token change in both modes (`pnpm check:ds` in the battlestack repo runs the gates for the theme itself).

## Token quick reference (CSS variables)

- Surfaces: `--ui-bg`, `--ui-bg-muted` (page canvas), `--ui-bg-elevated`, `--ui-bg-accented`, `--ui-bg-inverted`
- Text: `--ui-text-highlighted`, `--ui-text`, `--ui-text-toned`, `--ui-text-muted`, `--ui-text-dimmed`, `--ui-text-inverted`
- Borders: `--ui-border`, `--ui-border-muted`, `--ui-border-accented`, `--ui-border-inverted`
- Semantic colors: `--ui-primary`, `--ui-secondary`, `--ui-success`, `--ui-info`, `--ui-warning`, `--ui-error` (+ full ramps `--ui-color-<name>-50…950`)
- Radius: `--ui-radius` (base; `rounded-xs…3xl` are multiples) · Container: `--ui-container` · Header: `--ui-header-height`
- Fonts: `--font-sans` (Plus Jakarta Sans), `--font-mono` (JetBrains Mono) — self-hosted by `@nuxt/fonts`

## Brand

The Battlestack lockup is `<BsLogo>` (from the theme layer): three-bar mark + live-type wordmark, monochrome `currentColor` — it inherits any surface and scales with `font-size`. `<BsLogo :wordmark="false" />` renders the mark alone. Never rebuild it, never use an image for the wordmark.

## Sanctioned exceptions

- **Charts.** Nuxt UI has no chart components. Use the chart library agreed per project (themed with the `--ui-color-*` variables); do not hand-roll chart components.
- **Datepicker.** Complex date entry stays on `@vuepic/vue-datepicker` (see the Nuxt UI section in the docs): `UCalendar`'s keyboard semantics and locale support were judged too thin for our forms. This is the only component-level deviation; it is not a precedent.

## Copy conventions

Sentence case everywhere; buttons are verb + object ("Create customer", never "OK"); errors say what happened and what to do; no emoji, no exclamation marks; IDs/amounts/timestamps in `font-mono`.

## Definition of done

- [ ] Only Nuxt UI components (or compositions of them); zero new custom components without sign-off
- [ ] Semantic utilities/tokens only — no raw hex/px/palette classes where a token exists
- [ ] Light and dark verified; client theme verified when applicable
- [ ] Keyboard + visible focus intact; status not color-alone
- [ ] Component defaults changed via `app.config.ts` `ui`, not by wrapping or forking
