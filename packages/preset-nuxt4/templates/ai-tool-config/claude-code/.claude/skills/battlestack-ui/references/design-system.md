# Battlestack architecture and token contract

Hierarchy: `foundations → layout primitives → core components → application patterns → screens`. Screens are examples of the system, never a source of one-off styling.

## Package boundaries

These are Nuxt layers, each extending the one above it. A project extends exactly one.

- **Shared UI** — `@sevenlab/ui` (`packages/ui`): markup, APIs, behaviour, keyboard, accessibility, states, generic patterns. 64 exports, auto-imported under the `Bs` prefix. Zero client branding; only `var(--…)` references. Its own contributor contract is `packages/ui/PORTING.md`.
- **Default theme** — `@sevenlab/ui-default` (`packages/ui-default`): the Battlestack token values for light and dark, the Nuxt UI compatibility bridge, and the brand assets. Brand-neutral B2B base.
- **Client theme** — `@sevenlab/ui-<client>`: token overrides + brand assets only. Never a copy of the component library; component overrides only when tokens demonstrably cannot express the need — and if the same override recurs across clients, the shared system is incomplete.
- **Application**: business composition, data, copy.

The component library's own CSS lives in `packages/ui/styles/vendor/` and is vendored verbatim from the Claude Design export — never edit it, so a re-export stays a diff. Additive rules go in `styles/extra/<group>.css`.

## Token model

Three layers: `primitive → semantic → component`. Components consume semantic tokens; primitives exist only to define them. Use the repository's names when they differ — never rename an established token system outside a dedicated migration.

### The Battlestack contract (CSS custom properties)

- **Surfaces**: `--bg`, `--bg-sunken`, `--surface`, `--surface-raised`, `--surface-overlay`
- **Text**: `--fg`, `--fg-muted`, `--fg-subtle`, `--fg-disabled`, `--fg-inverse`
- **Borders**: `--border-subtle` (hairlines), `--border` (cards/dividers), `--border-strong` (form controls, ≥3:1), `--border-hover`
- **Interaction**: `--hover`, `--active`, `--row-selected`, `--selection`
- **Primary**: `--primary(-hover/-active/-fg/-tint/-tint-fg/-border)`
- **Status**: `--success/--warning/--danger/--info` + `-bg`/`-border`; `--danger-solid` for solid buttons
- **Focus & links**: `--focus`, `--link`, `--link-hover`
- **Elevation**: `--shadow-card/raised/overlay` — borders do most edge work
- **Charts**: `--chart-1…5`, `--chart-grid`
- **Nav chrome**: `--nav-bg/fg/fg-muted/border/hover/active-bg/active-fg/edge/logo-bg/logo-fg` — ink sidebar in both themes by default; override this group alone for light chrome
- **Type**: `--font-sans`, `--font-mono`, `--text-xs…4xl`, `--weight-*`, `--leading-*`
- **Size & layout**: `--space-1…20` (4px grid), `--radius-sm/md/lg/xl/full`, `--control-h-sm/md/lg`, `--control-radius`, `--check-radius`, `--card-radius`, `--card-p`, `--table-row-h`, `--topbar-h`, `--sidebar-w`, `--content-max` (page width, default `100%`), `--dialog-w-*`, `--focus-w/offset`
- **Motion & layers**: `--dur-fast/base/slow`, `--ease-standard/out`, `--z-dropdown/sticky/drawer/dialog/menu/toast/tooltip`

Light values live on `:root`, dark on `[data-theme="dark"]` — same names, independently tuned (dark is not an inversion).

## Component inventory

Layout: Container, Stack, Inline, Grid, Section, Divider, PageLayout. Actions: Button, IconButton, Link. Forms: Input, Textarea, Select, Combobox, Checkbox, Radio(Group), Switch, FormField, Label, HelperText, ValidationMessage. Display: Card, Badge, Avatar(Group), Table, Skeleton, Spinner, EmptyState. Feedback: Alert, Toast(Stack), Dialog, Drawer, Tooltip, Popover. Navigation: Tabs, Accordion, DropdownMenu, Pagination, Breadcrumbs. Patterns: AppShell, SidebarNav, TopNav, HorizontalNav (items take a `menu` array for dropdowns), PageHeader, Toolbar, FilterChip, DataTable, StatCard, FormSection, FieldRow, ConfirmDialog, Stepper. Plus charts (Bar/Line/Donut), chat kit, Icon (Lucide subset).

Do not add duplicates under slightly different names.

## Implementation notes

- Overlays that can sit inside scroll containers (menus) render via a portal on `document.body` at `--z-menu` and reposition on scroll/resize — follow `DropdownMenu`.
- Copy: sentence case; buttons are verb + object; errors say what happened and what to do; no emoji or exclamation marks; IDs/amounts/timestamps in `--font-mono`.
- Reference implementations, `.d.ts` API contracts, and `.prompt.md` usage notes ship with the design-system project; the reference app (`ui_kits/app/`) shows composition.
