# UI review checklist

Verify the applicable items before finishing.

**System reuse**
- [ ] Only Nuxt UI components (or compositions of them); no custom UI components, no styling wrappers
- [ ] Recurring compositions/defaults promoted to `app.config.ts` `ui` instead of repeated locally

**Tokens & styling**
- [ ] Semantic utilities everywhere a token exists (`text-muted`, `bg-elevated`, `rounded-md`); no unexplained hex, px, or palette classes
- [ ] No invented token names; overrides re-value documented `--ui-*` names only
- [ ] Per-instance styling done via props / `ui` slot classes, not global CSS overriding Nuxt UI's classes

**Themes**
- [ ] Light works; dark works; every `:root` override restated in `.dark`
- [ ] Contrast gate passed after color changes (see theming-accessibility.md)

**States**
- [ ] default / hover / focus-visible / active / selected / disabled / loading / error correct where applicable (they come from Nuxt UI — verify they weren't styled away)

**Accessibility**
- [ ] Keyboard operable; visible focus intact; overlay focus return untouched
- [ ] Labels via `UFormField`; accessible names on icon-only controls
- [ ] Status and validation not color-alone

**Responsive**
- [ ] Correct at supported breakpoints; no unexpected overflow; data-heavy views degrade gracefully

**Engineering**
- [ ] Lint/typecheck/tests pass where available
- [ ] Every deviation from "stock Nuxt UI + tokens" has a stated rationale (and matches a sanctioned exception)
