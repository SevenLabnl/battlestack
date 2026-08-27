# UI review checklist

Verify the applicable items before finishing.

**System reuse**
- [ ] Existing components and patterns checked first; no duplicates under new names
- [ ] New components/patterns are generic and reusable; client logic stays out of shared UI

**Tokens & styling**
- [ ] Semantic tokens everywhere a token exists; no unexplained hardcoded values
- [ ] New tokens are reusable concepts; component tokens only where semantic ones fall short
- [ ] New variants are functional distinctions, not one-off looks

**Themes**
- [ ] Light works; dark works; active client theme works
- [ ] Differences expressed through tokens; no duplicated light/dark implementations
- [ ] Contrast gate passed after color changes (see theming-accessibility.md)

**States**
- [ ] default / hover / focus-visible / active / selected / disabled / loading / error correct where applicable

**Accessibility**
- [ ] Semantic HTML; keyboard operable; focus order and management correct
- [ ] Labels on controls; accessible names on icon-only controls
- [ ] Validation and status not by color alone; async status announced when needed
- [ ] Reduced motion respected

**Responsive**
- [ ] Correct at supported breakpoints; no unexpected overflow; data-heavy views degrade gracefully

**Engineering**
- [ ] Public APIs preserved unless intentionally changed
- [ ] Lint/typecheck/tests pass where available; tests updated when appropriate
- [ ] Every new component, variant, pattern, or token has a stated rationale
