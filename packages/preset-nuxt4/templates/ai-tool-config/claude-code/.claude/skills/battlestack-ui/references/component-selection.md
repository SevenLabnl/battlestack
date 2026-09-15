# Component selection and extension

## Decision sequence

1. **A Nuxt UI component solves it?** Use it. No local substitutes, no styling wrappers.
2. **Composition solves it?** Compose in the app layer: `UCard + UBadge + UButton` beats a `CustomerStatusCard`. Recurring compositions may become app-level pattern components — domain-neutral, slots/props instead of embedded entity logic — but they still render only `U*` components inside.
3. **Only the visual treatment differs?** In order: component props (`variant`, `color`, `size`) → per-instance `ui`/slot classes → `app.config.ts` default under `ui` → token re-value (`brand.css`, or the theme layer when it should hold for every project).
4. **Genuinely missing behaviour?** That is a design-system gap: raise it (design project first, then `@battlestack/theme`/scaffold), don't patch it locally. The bar for "Nuxt UI can't do this" is high — check props, slots, and the `ui` theming API before claiming it.

## Variant rules

Use the functional variants Nuxt UI defines (`solid`, `outline`, `soft`, `subtle`, `ghost`, `link`; sizes `xs–xl`; semantic `color` names). Never add color-, client-, page- or campaign-named variants via app.config (`client-blue`, `dashboard-special`).

## Token vs component

A missing concept that is **visual** → token value change. A missing concept that is **structural, behavioural, or interactive** → check Nuxt UI harder, then escalate. Never solve a behavioural problem with theme CSS.

## Business components

Domain components (tied to Customer, Invoice, Project…) live in the application — as compositions of `U*` components. They never migrate into the theme layer; the theme ships exactly one component (`BsLogo`, brand).

## Refactoring signals

The same composition or `ui` override repeating across screens or projects means the default belongs in `app.config.ts` (project) or the theme layer (all projects). Promote it and delete the local copies.
