---
name: battlestack-ui
description: Apply the Battlestack (SevenLab UI) design system when building, modifying, reviewing, or refactoring frontend UI in SevenLab boilerplate projects. Use for page implementation, component work, styling, design-to-code handoff from Claude Design, light/dark theming, client themes, accessibility reviews, and any request that could introduce new UI components, variants, tokens, or patterns. Enforces reuse of the existing UI package, semantic design tokens, WCAG 2.2 AA, stable generic component APIs, and the rule that client branding lives in theme tokens only.
---

# Battlestack UI

Build application UI as an extension of the existing design system, never as a local visual system. **Structure and behaviour stay stable; styling is configurable — and styling lives exclusively in design tokens.** Per-client branding is a token override, never a component fork.

## What exists

`@sevenlab/ui` ships **64 exports** as Nuxt layer components, auto-imported under the `Bs` prefix — `<BsButton>`, `<BsDataTable>`, `<BsDialog>`. The layers stack:

```
@sevenlab/ui          components: markup, behaviour, states, keyboard, ARIA. No brand values.
  ^ themed by
@sevenlab/ui-default  token values for light + dark, the Nuxt UI bridge, brand assets
  ^ overridden by
@sevenlab/ui-<client> token overrides + client assets. Nothing else.
```

A project extends one layer (`extends: ['@sevenlab/ui-default']`, or the client theme) and gets the whole stack.

`@nuxt/ui` may still be installed. It is a **compatibility layer** for battlestack's own older feature UI, kept on-brand by a token bridge in the default theme. New work uses `Bs*`. Do not add new `U*` markup.

## Workflow

### 1. Inspect before changing

- Read the actual component APIs and token names before proposing anything. Never assume a component, token, or path exists.
- Repository conventions beat the example names in this skill. Project docs beat this skill, unless they would violate accessibility.
- `DESIGN_SYSTEM.md` in the repo root is the project-level authority.

### 2. Classify the change — pick the earliest valid option

1. Reuse an existing component.
2. Compose existing components (application layer).
3. Adjust or add a semantic token.
4. Add a client theme override.
5. Extend a generic component/variant.
6. Create a new reusable component.

State your classification in one line before implementing. For 3-6, read `references/component-selection.md` first.

### 3. Implement with tokens

- Semantic tokens only in components and screens (`var(--primary)`, `var(--space-4)`); primitives only to define semantic tokens; raw values never when a token exists.
- Generic APIs: variants are functional (`primary/secondary/ghost/danger`, `sm/md/lg`), never client-, color-, or page-named.
- All interaction states (default/hover/focus-visible/active/selected/disabled/loading/error) live in the shared component, not the page.
- Same token names in light and dark; `data-theme="dark"` switches values. No theme conditionals in components.
- Token contract and layer boundaries: `references/design-system.md`.

### 4. Claude Design handoff

The design system is the constraint; a design is an instance of it. Map to existing components and tokens first; treat differences as token gaps, not as one-off CSS; escalate genuine gaps as system changes. Don't pixel-match one-off decisions.

### 5. Validate

Run the repo's lint, typecheck and tests.

## Where things are — this differs by repo

**In an application project** the library is a dependency, so read it there:

| Path | What |
| --- | --- |
| `node_modules/@sevenlab/ui/components/<group>/<Name>.vue` | The component. Its `defineProps` **is** the API contract. |
| `node_modules/@sevenlab/ui/PORTING.md` | The contract every component is written against. |
| `node_modules/@sevenlab/ui-default/tokens/tokens.d.ts` | Every semantic token name, as a union type. Generated. |
| `node_modules/@sevenlab/ui-default/tokens/tokens.json` | The same names with their resolved light and dark values. |
| `app/assets/css/brand.css` | Where this project overrides token **values**. Yours to edit. |
| `DESIGN_SYSTEM.md` (repo root) | The project-level authority. |

Never edit anything under `node_modules/` — the next install throws it away. A fix in a component arrives as a version bump.

**In the design system's own repository** the packages are `packages/ui` and `packages/ui-default`, and three gates run there:

```
pnpm check:ds
```

- **contrast** — WCAG pairs resolved through the real `var()` chains, in *both* themes. Any colour change must pass this, in the client theme too.
- **contract** — a theme may change token *values*, never add or drop a token *name*.
- **layers** — no primitive token, raw hex or raw px in a component, and no additive CSS rule quietly taking over a class the design system already owns.

A failing gate is a real finding. Do not weaken a gate to make it pass. Note none of them can see a consuming app: that is why `brand.css` may only re-value names the system already defines, never invent one.

Known defects in the design system's own export are tracked in an internal findings log, and things the library deliberately does not do are in that repo's `docs/known-limitations.md`. Ask before reporting something as new.

For work touching colors, themes, forms, overlays, keyboard, or motion: `references/theming-accessibility.md`. Before finishing: `references/review-checklist.md`.

## Guardrails — never

- Hardcode brand values in shared components, or client logic in the generic package.
- Create dark/light duplicate components.
- Add a variant to match one screen, or a business-entity component (`CustomerStatusCard`) to the generic package.
- Remove visible focus styling; communicate status via color alone; trade accessibility for visual fidelity.
- Edit the library's `styles/vendor/**`. That is the design system's own CSS and has to stay diffable against the next export; additive rules go in `styles/extra/<group>.css`, and only in the design system's own repo.

## Response behaviour

Report only design-system implications: what was reused, any new component/variant/token and why, and remaining system or accessibility risks. Skip routine implementation narration.
