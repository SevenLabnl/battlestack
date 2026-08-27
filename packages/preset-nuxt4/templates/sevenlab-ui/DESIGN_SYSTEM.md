# Design system

This project uses **Battlestack**, SevenLab's UI design system. Always build and modify user interfaces through it.

The system is brand-neutral by design: **every client is themed by overriding design tokens only**. Component structure, APIs, UX patterns and behaviour are identical across clients. If you find yourself changing a component to achieve branding, stop — that change belongs in tokens, or it is a system-wide change that needs discussion.

## Where it lives

Three Nuxt layers, each extending the one before it. `nuxt.config.ts` extends the theme; the component layer comes with it.

| Layer | Package | What it owns |
| --- | --- | --- |
| Components | `@sevenlab/ui` | Markup, behaviour, states, accessibility. Defines no value of its own. |
| Default theme | `@sevenlab/ui-default` | Token values for light and dark, the Nuxt UI bridge, the brand lockup. |
| Client theme | `@sevenlab/ui-<client>` | Token values that differ for one client. Nothing else. |

Both packages are installed from npm, not vendored into this repo. A fix in a component arrives as a version bump — never as an edit under `node_modules/`, which the next install throws away.

What to read, and where it actually is:

| Path | What |
| --- | --- |
| `node_modules/@sevenlab/ui/components/<group>/<Name>.vue` | The component. Its `defineProps` **is** the API contract — prop names, variant names and size names are identical across every client. |
| `node_modules/@sevenlab/ui/PORTING.md` | The binding contract every component is written against. Read it before proposing a change to one. |
| `node_modules/@sevenlab/ui-default/tokens/tokens.d.ts` | Every semantic token name, as a TypeScript union. Generated. |
| `node_modules/@sevenlab/ui-default/tokens/tokens.json` | The same names with their resolved light and dark values. Generated. |
| `app/assets/css/brand.css` | This project's own token overrides. The only styling file the project owns. |

## Available components

All registered globally with a `Bs` prefix, so `components/actions/Button.vue` is `<BsButton>`. Tree-shaken: an unused component costs nothing.

- **Actions** — `BsButton`, `BsIconButton`, `BsLink`
- **Layout** — `BsContainer`, `BsDivider`, `BsGrid`, `BsInline`, `BsPageLayout`, `BsSection`, `BsStack`
- **Forms** — `BsCheckbox`, `BsCombobox`, `BsFormField`, `BsHelperText`, `BsInput`, `BsLabel`, `BsRadio`, `BsRadioGroup`, `BsSelect`, `BsSwitch`, `BsTextarea`, `BsValidationMessage`
- **Display** — `BsAvatar`, `BsAvatarGroup`, `BsBadge`, `BsCard`, `BsEmptyState`, `BsSkeleton`, `BsSpinner`, `BsTable`
- **Feedback** — `BsAlert`, `BsDialog`, `BsDrawer`, `BsPopover`, `BsToast`, `BsToastStack`, `BsTooltip`
- **Navigation** — `BsAccordion`, `BsBreadcrumbs`, `BsDropdownMenu`, `BsPagination`, `BsTabs`
- **Patterns** — `BsAppShell`, `BsConfirmDialog`, `BsDataTable`, `BsFieldRow`, `BsFilterChip`, `BsFormSection`, `BsHorizontalNav`, `BsPageHeader`, `BsSidebarNav`, `BsStatCard`, `BsStepper`, `BsToolbar`, `BsTopNav`
- **Charts** — `BsBarChart`, `BsDonutChart`, `BsLineChart`
- **Chat** — `BsChatComposer`, `BsChatMessage`, `BsChatSuggestions`, `BsTypingIndicator`
- **Icons** — `BsIcon`
- **Brand** (theme layer) — `BsBrandLockup`. A client theme ships its own and it wins.

Toasts are raised through the `useBsToast()` composable, with one `<BsToastStack>` mounted in the shell.

## Core rules

1. **Reuse before creating**
   - Check the list above first, then the component's `defineProps` for what it already supports.
   - Compose existing components over creating new ones.
   - Never create project-specific replacements for existing design-system components.

2. **Use design tokens — semantic layer only**
   - Never hardcode colors, spacing, radius, shadows or typography when a token exists.
   - Components reference semantic tokens (`var(--primary)`, `var(--surface)`, `var(--space-4)`), never primitives (`--blue-500`) and never raw values (`#2f66f5`, `12px`).
   - Client branding is implemented in the client theme's tokens, nowhere else. This project's own overrides go in `app/assets/css/brand.css`.

3. **Keep component APIs generic**
   - Functional variants only: `primary`, `secondary`, `ghost`, `danger`; sizes `sm/md/lg`.
   - No client-specific variants or props (`variant="client-blue"` is forbidden).

4. **Support both themes**
   - Light lives on `:root`, dark on `[data-theme="dark"]` — same token names, different values.
   - `data-theme` is set on `<html>` by the theme layer's client plugin, which mirrors the `.dark` class that Nuxt UI and `@nuxtjs/color-mode` switch on. Use the app's colour-mode switcher; never write theme conditionals inside components, and never read an `isDark` flag.

5. **Accessibility is required (WCAG 2.2 AA)**
   - Semantic HTML, keyboard interaction, visible `focus-visible` ring (2px `--focus`), accessible names/labels.
   - Status and errors always use color **plus** text or an icon.
   - Contrast: text ≥4.5:1; control borders and focus ring ≥3:1 — re-verify after any token change, in both themes.
   - Respect `prefers-reduced-motion`.

## Token quick reference

`tokens.d.ts` is the generated, complete list; this is the map.

- **Surfaces**: `--bg`, `--bg-sunken`, `--surface`, `--surface-raised`, `--surface-overlay`
- **Text**: `--fg`, `--fg-muted`, `--fg-subtle`, `--fg-disabled`, `--fg-inverse`
- **Borders**: `--border-subtle` (hairlines), `--border` (cards/dividers), `--border-strong` (form controls), `--border-hover`
- **Interaction**: `--hover`, `--active`, `--row-selected`, `--selection`
- **Primary**: `--primary`, `--primary-hover`, `--primary-active`, `--primary-fg`, `--primary-tint`, `--primary-tint-fg`, `--primary-border`
- **Secondary & controls**: `--secondary-bg/-fg/-border`, `--control-checked`, `--control-checked-fg`
- **Status**: `--success/--warning/--danger/--info` + `-bg`/`-border`; solid buttons use `--danger-solid` (+ `--danger-solid-hover`)
- **Focus & links**: `--focus`, `--link`, `--link-hover`
- **Elevation**: `--shadow-card`, `--shadow-raised`, `--shadow-overlay` (borders do most edge work); `--backdrop`, `--skeleton`, `--glow`, `--glow-btn`, `--tooltip-bg/-fg`
- **Charts**: `--chart-1…5`, `--chart-grid`
- **Nav chrome**: `--nav-bg/fg/fg-muted/border/hover/active-bg/active-fg/edge/logo-bg/logo-fg` (sidebar is ink in both themes by default; override this group alone for light chrome)
- **Type**: `--font-sans`, `--font-mono`, `--text-xs…4xl`, `--weight-*`, `--leading-*`, `--tracking-caps`
- **Layout & size**: `--space-0…20` (4px grid), `--radius-sm/md/lg/xl/full`, `--icon-sm/md/lg`, `--control-h-sm/md/lg`, `--control-px-*`, `--control-radius`, `--check-radius`, `--card-radius`, `--card-p`, `--field-gap`, `--form-gap`, `--table-row-h`, `--table-head-h`, `--topbar-h`, `--sidebar-w` (+ `--sidebar-w-collapsed`), `--content-max` (page body width, 1280px in the default theme), `--dialog-w-sm/md/lg`, `--drawer-w`, `--focus-w/offset`
- **Motion & layers**: `--dur-fast/base/slow`, `--ease-standard/out`, `--z-dropdown/sticky/drawer/dialog/menu/toast/tooltip`

Tailwind's own scale is re-based on these, deliberately: `rounded-md` is the design system's `--radius-md`, `text-sm` its `--text-sm`. One scale, not two.

## Before building UI

1. Does the component exist? Check the list above, then its `defineProps`.
2. Can existing components compose the interface? `BsAppShell`, `BsPageLayout`, `BsPageHeader` and `BsDataTable` already cover most screens.
3. Check the conventions below — container choice, feedback choice, form/table/destructive-action rules — and follow the pattern an existing screen already uses.
4. Check available semantic tokens.
5. Only then consider a new component or token — and treat that as a design-system change, not an app-local one.

## Component states

Interactive components support: default, hover, focus-visible, active, selected, disabled, loading, error. These live in the component implementation. Do not rebuild states inside application screens.

Overlays that can sit inside scroll containers (menus) render via a portal on `document.body` at `--z-menu` — follow `DropdownMenu`'s implementation.

## Nuxt UI markup

Battlestack's own scaffolded shell still emits Nuxt UI components (`UCard`, `UButton`, …). The theme layer ships a bridge (`styles/bridge.css`) that maps our semantic tokens onto Nuxt UI's `--ui-*` variables, so that markup is on-brand without being touched.

It is a compatibility layer with an end date. New UI uses `Bs*` components. Do not add Nuxt UI markup to a screen because it was easier to find.

## Client theming

Client branding changes, in order of likelihood:

1. Accent scale + semantic accent mappings (`--primary*`, `--link`, `--focus`, `--chart-*`)
2. Neutral tint (`--gray-*`) and surfaces
3. Typography (`--font-sans/mono` + font loading)
4. Radius scale and shadows
5. Nav chrome (`--nav-*`: ink vs light)
6. Assets (logo)

For one project, that goes in `app/assets/css/brand.css`. For a client with more than one project, it goes in a `@sevenlab/ui-<client>` theme package extending `@sevenlab/ui-default`, so every project of theirs picks it up from one place.

Not allowed for branding: editing component markup/CSS, forking the component library, adding client variants, changing semantic token *names*. After any color change, re-verify the contrast pairs above in light **and** dark.

## When implementing a design

The design system remains authoritative over any individual design. If a design appears to introduce a new color, arbitrary spacing, a new component/variant, or a new interaction pattern: first solve it with the existing system. Prefer system consistency over one-off visual matching; escalate genuine gaps as system changes.

## Copy conventions

Sentence case everywhere; buttons are verb + object ("Create customer", never "OK"); errors say what happened and what to do; no emoji, no exclamation marks; IDs/amounts/timestamps in `--font-mono`.

## The gates

Three checks run in the design system's own repository, on every theme including each client one — `pnpm check:ds` runs all three:

- **Contrast** (`check:contrast`) resolves every `var()` chain the way a browser would and checks 20 WCAG 2.2 AA pairs in both themes. A theme that nudges the accent and drops below 4.5:1 fails there.
- **Token contract** (`check:contract`) fails a theme that adds a semantic token name or drops one. The names are the contract; the values are the theme.
- **Layer rules** (`check:layers`) fails a component that reaches past the semantic layer — a primitive, a raw hex, a raw px where a token exists — or that takes a class name the vendored CSS already uses.

None of them can see this repository. Overrides in `app/assets/css/brand.css` are outside the contract gate's reach, which is exactly why that file re-values existing token names and never invents one, and why a colour change there is re-checked by hand in both themes.

## Definition of done

- [ ] Existing components reused; no one-off replacements
- [ ] Semantic tokens only — no hardcoded styling, no primitives in screens
- [ ] Light and dark both work; no theme logic in components
- [ ] Keyboard interaction works; focus states visible
- [ ] Relevant states implemented (hover/disabled/loading/error)
- [ ] Contrast verified after token changes (both themes)
- [ ] Responsive behaviour correct
- [ ] No client-specific logic in generic UI components; client styling lives in `app/assets/css/brand.css` or a client theme package
