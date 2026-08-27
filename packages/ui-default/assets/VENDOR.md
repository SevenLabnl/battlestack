# Brand assets

Copied verbatim from the Battlestack Design System export (2026-08-20).

- `battlestack-mark.svg` — the **product** mark: three stacked bars, drawn in
  `currentColor` with depth via opacity, so it inherits whatever surface it sits
  on and needs no light/dark variant. This is the one a UI uses.
- `logo.svg`, `logo-dark.svg`, `logo-mark.svg` — the **SevenLab company** logo,
  kept for company-level material. Not for in-app chrome.

These live in the theme package, not in `@sevenlab/ui`: brand identity is exactly
what a client theme replaces. A client theme ships its own `assets/` and its own
`BrandLockup.vue`; the component library never learns a brand.
