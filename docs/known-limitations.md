# Known limitations

Things `@sevenlab/ui` does not do, and why. Separate from
the internal design-system findings log, which is about the design system itself —
these are ours, or upstream.

Each entry says what breaks, how bad it is, and what it would cost to fix, so
nobody has to re-derive that when they trip over it.

---

## `Combobox` has an empty `aria-controls` until the panel is first opened

**Upstream: reka-ui 2.10.3.**

`ComboboxRoot` provides `contentId: ''` and only `ComboboxContent`'s setup does
`rootContext.contentId ||= useId(…)`. Since the content mounts on first open, the
input renders `aria-controls=""` before that. From the first open onward it is
correct.

We cannot supply the id ourselves: `ComboboxContentImpl` binds
`id: rootContext.contentId` *after* `$attrs` inside `mergeProps`, so anything we
pass is overwritten.

**Impact: low.** `role="combobox"`, `aria-expanded` and `aria-activedescendant`
are all correct, and screen readers announce the listbox on open. Only the
pointer from the collapsed input is missing.

**The fix would be** `force-mount` on the content, which mounts the panel
immediately so the id is assigned. That keeps the whole listbox in the DOM for
every combobox on the page, permanently, to fix an attribute that only matters
while collapsed. Not worth it. Revisit if Reka makes `contentId` reactive.

Note this is **not** the same problem as `Accordion`'s empty `aria-controls`,
which *was* fixable — there we render both the trigger and the panel and can own
the id pair. Different primitive, different constraint.

## `Link` cannot do in-app navigation

`Link.d.ts` declares only `href`, so `<BsLink>` is a plain `<a>` and a click
triggers a full page load in a Nuxt app. Adding a `to` prop that renders
`<NuxtLink>` is the obvious fix, but it changes the component contract, which is
design's call — see design-system finding 6 in the internal findings log.

**Workaround until then:** use `<NuxtLink class="bs-link">` directly for in-app
links. The class carries the styling; only the component wrapper is missing.

## Dark mode flashes light token values on a server-rendered page

`@sevenlab/ui-default`'s theme plugin mirrors the colour-mode `.dark` class onto
`[data-theme="dark"]` after hydration, so a server-rendered dark page briefly
paints light values.

**The fix** is to bind `data-theme` through `useHead` from the colour-mode state
so it ships in the SSR markup. Planned; the plugin carries the same note.

## A tooltip dismisses itself when its trigger is reached by Tab from off screen

**Upstream: reka-ui 2.10.3.**

`TooltipContentImpl` closes on any scroll event whose target contains the trigger.
Tabbing to an off-screen trigger makes the browser scroll it into view, which fires
exactly that event — so the tooltip opens and is dismissed in the same tick.

Confirmed not to be a smooth-scrolling artefact: it reproduces with instant
scrolling too.

**Impact: low but real.** Once the trigger is already on screen — the normal case —
focus opens the tooltip and it stays. Only a keyboard user arriving from far up the
page loses it.

**Not worked around**, because every workaround means intercepting Reka's dismiss
logic. Revisit on a Reka upgrade.

