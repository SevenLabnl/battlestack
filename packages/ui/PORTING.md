# Porting the design system to Vue

The binding contract for every component in `@sevenlab/ui`. Read this before
writing a component; it is what keeps 64 components written by different people
looking like one library.

## Where things live

| Path | What |
| --- | --- |
| `design-system-source/` (repo root) | The Claude Design export. **Read-only reference.** Every component has a `.jsx` (reference implementation), a `.d.ts` (the API contract) and a `.prompt.md` (usage). |
| `design-system-source/guidelines/ux-patterns.md` | Binding UX conventions. |
| `packages/ui/components/<group>/<Name>.vue` | Where your component goes. |
| `packages/ui/styles/vendor/*.css` | The design system's own CSS. **Never edit.** |
| `packages/ui/styles/extra/<group>.css` | Your group's additive CSS. Only you touch this file. |
| `test/nuxt/ui/<Name>.test.ts` | Component tests (`environment: 'nuxt'`, happy-dom). |

## The prime directive

The vendored CSS already styles these components. A port is **markup + behaviour
that produces the right classes** — it is not a rewrite of the styling. Before
adding any CSS, grep `styles/vendor/` for the class the reference uses.

## API rules

Prop names, variant names and size names are copied **literally** from the
`.d.ts`. That contract has to hold across clients, so `variant="primary"`,
`size="sm"`, `invalid`, `loading`, `block` keep their exact spelling. What
changes is only how React idiom is expressed:

| React | Vue |
| --- | --- |
| `value` + `onChange` | `v-model` (`modelValue` + `update:modelValue`) |
| `render: (row) => node` | scoped slot `#cell-<key>`, with the prop kept as fallback |
| `ReactNode` prop (`icon`, `actions`, `footer`, `title`) | named slot; keep a `string` prop shorthand where the reference only ever passes text |
| `trigger={<el/>}` | `#trigger` slot |
| `items` / `columns` / `tabs` config arrays | stay props — they come straight from the contract |
| `React.forwardRef` | `defineExpose` for methods; native attrs fall through by default |
| `className` | native `class` (attribute fallthrough — do not declare a `class` prop) |
| `style` passthrough | attribute fallthrough |

Extra rules:

- Every component is `<script setup lang="ts">` with typed `defineProps` and
  `withDefaults`. Defaults must match the `.d.ts` defaults exactly.
- Emit names are `update:modelValue`, plus whatever the reference calls back
  (`select`, `close`, `sortChange` — camelCase, no `on` prefix).
- Do not declare `inheritAttrs: false` unless the component has a wrapper element
  the attrs must skip. If you do, document why in a comment.
- Components never read a theme. There is no `isDark` anywhere. `[data-theme]`
  does the work.

## Styling rules

- Semantic tokens only: `var(--fg-muted)`, `var(--space-4)`, `var(--card-radius)`.
- **Never** a primitive (`--gray-200`, `--blue-500`) and never a raw hex or px
  where a token exists. This is enforced by the layer gate in CI.
- Inline styles in the reference (`style={{display:'flex',gap:'8px'}}`) become a
  class in `styles/extra/<group>.css`. Keep the `bs-` prefix.
- Dynamic values that genuinely vary per instance (a spinner's `--sp`, a grid's
  column count) stay inline as a custom property.

## Accessibility

The export is honest about its own gaps — closing them is part of the port, not
a follow-up:

- Dialog and Drawer have no focus trap in the reference. Ours must trap focus,
  restore it on close, and mark background content inert.
- DropdownMenu has no roving focus or typeahead. Ours must.
- Combobox builds the listbox pattern by hand. Ours uses the headless primitive.

Baseline for everything: WCAG 2.2 AA, semantic HTML, visible `:focus-visible`
ring, accessible names, `role`/`aria-*` as the reference has them, Escape closes
overlays, arrows move within composites, status is never colour alone.

## Which components get a headless behaviour layer

`reka-ui` is a dependency of `@sevenlab/ui`. Use it for exactly these:

> Dialog, Drawer, Popover, Tooltip, DropdownMenu, Tabs, Accordion, Combobox,
> Toast/ToastStack

Use Reka's `asChild` / `as` so **our** markup and `bs-*` classes render — Reka
supplies behaviour, never appearance.

These deliberately stay **native** and must not use Reka: `Select`, `Checkbox`,
`Radio`, `RadioGroup`, `Switch`. The vendored CSS styles native inputs
(`.bs-check > input`), and native wins on mobile and inside forms.

Everything else is plain Vue: markup plus classes.

## Copy

Any user-visible string a component ships (an empty state's default title, a
spinner's label) follows the design system's conventions: sentence case, buttons
are verb + object, errors say what happened and what to do, no emoji, no
exclamation marks. Keep them in English — apps localise at their own layer.

## Vue traps that have already bitten this port

- **Never put a comment above the root element in `<template>`.** Dev builds keep
  template comments, which makes the component multi-root and silently drops
  attribute fallthrough — `class`, `data-*` and everything else stops landing.
  This was verified, not theorised: two components shipped with it. Put the note
  in `<script setup>` instead.
- **A comment inside a `v-if` branch has the same effect** on that branch.
- **Fallthrough attrs are applied after the template's own**, so a hardcoded
  `type="button"` in the template is still overridable by the caller — that is how
  the React `{...rest}` spread is reproduced.
- **Never reuse a class name the vendored CSS already defines** for a different
  element. `styles/extra/*.css` lands after `styles/vendor/*.css` in the same
  cascade layer, so the vendored rule and yours both apply. `.bs-page` is the
  vendored pagination-button class; a PageLayout rule took the same name and gave
  every page button `min-height: 100vh`. The layer gate now fails on any collision
  that is not in its acknowledged list — scoping or augmenting a vendored class is
  fine, taking the name for something else is not.
- **Vue Test Utils can report a Reka-backed component as multi-root.** Reka's
  `PopperRoot` renders a bare `<slot/>`, and VTU's `hasMultipleRoots` recursion
  reads that fragment as multiple roots even though the real DOM has one element.
  `wrapper.element` then points at the mount container. Use a helper that reaches
  the real root instead of asserting on `wrapper.element`, and say so in the test.
- **`v-model` on a child does not expose the child's DOM node.** If a component
  needs the element (auto-resize, focus), expose it with `defineExpose({ el })`
  the way `forms/Input.vue` does, rather than reaching through `$el`.

## Code style

The repo's ESLint config: 4-space indent, single quotes, **no semicolons**,
trailing commas, `1tbs` braces. Run `npx eslint <your files>` before finishing;
it must be clean.

## Definition of done, per component

1. Every prop, variant, size and state from the `.d.ts` is implemented.
2. Renders the same classes as the reference `.jsx`.
3. No hardcoded values; semantic tokens only.
4. Keyboard and ARIA behaviour verified against the reference and the a11y
   section above.
5. A test in `test/nuxt/ui/<Name>.test.ts` covering: default render, each
   variant/size mapping to its class, every boolean state, and the keyboard
   interaction if the component has one.
6. `npx eslint` clean.

## What not to do

- Do not run `nuxi build`, `nuxt dev` or the full test suite — several agents
  share this working tree and those commands write to `.nuxt/`. The integration
  pass runs centrally.
- Do not edit `packages/ui/styles/index.css`, `packages/ui/nuxt.config.ts`,
  `package.json`, or another group's `extra/*.css`.
- Do not add a component that is not in your assignment, even if you need it —
  note the dependency in your report instead.
- Do not invent variants, tokens or props that the `.d.ts` does not have.
