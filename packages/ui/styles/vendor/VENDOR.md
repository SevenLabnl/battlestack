# Vendored CSS

These files are copied **byte-identical** from the Battlestack Design System export
(Claude Design). They are the design system's own component CSS: `bs-*` classes that
reference semantic tokens only.

## Rules

- **Never edit a file in this directory.** Additive rules go in `../extra.css`.
- Layer assignment happens at the import site in `../index.css`, not in these files,
  so a re-export stays a diff instead of a merge.
- To take in a new export: `pnpm ds:sync <export.zip>` diffs it against this directory
  and reports what changed before writing.

## Provenance

| Source | Export date |
| --- | --- |
| `css/base.css` | 2026-08-20 |
| `css/controls.css` | 2026-08-20 |
| `css/surfaces.css` | 2026-08-20 |
| `css/patterns.css` | 2026-08-20 |
