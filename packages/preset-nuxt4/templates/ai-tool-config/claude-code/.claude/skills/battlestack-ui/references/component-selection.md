# Component selection and extension

## Decision sequence

1. **Existing component solves it?** Use it. No local substitutes.
2. **Composition solves it?** Compose in the application layer: `Card + Badge + Button` beats adding `CustomerStatusCard` to the generic package.
3. **Recurring across screens/flows?** Consider an application pattern — domain-neutral, slots/props instead of embedded entity logic.
4. **Only the visual treatment differs?** In order: existing semantic token → new semantic token (if broadly reusable) → client theme override → component token (stable reusable need) → variant, only when the difference is functional/semantic.
5. **Genuinely new, reusable behaviour?** Extend an existing component or create a new generic one. It must have one responsibility, a generic API, all relevant states, token-only styling, both themes, and pass accessibility — with no business copy or data logic inside.

## Variant rules

Variants encode stable functional distinctions: `primary`, `secondary`, `ghost`, `danger`, sizes `sm/md/lg`. Never color-, client-, page-, or campaign-named (`client-blue`, `dashboard-special`).

## Token vs component

Missing concept is **visual and reusable** → token. Missing concept is **structural, behavioural, or interactive** → component. Never solve a behavioural problem with theme CSS.

## Business components

Domain components (APIs tied to Customer, Invoice, Project…) live in the application/domain layer. Promote to shared UI only after the structure proves generic and recurrent.

## Refactoring signals — move it into the system when

- the same local CSS/state handling repeats;
- multiple projects build similar wrappers or near-identical APIs;
- multiple client themes need the same override;
- accessibility fixes recur at page level.

When promoting, remove the duplicated local implementations if the task scope allows.
