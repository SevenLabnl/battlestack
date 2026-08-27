<script setup lang="ts">
import { computed, useSlots } from 'vue'

// Port of components/patterns/AppShell.jsx — the application frame. It is
// deliberately thin: `.bs-shell`, `.bs-shell__main` and `.bs-shell__content` are
// already a full grid in styles/vendor/patterns.css, so all this component does is
// pick the layout and place three slots into it.
//
// `sidebar`, `topbar` and `children` are ReactNode props in AppShell.d.ts, so they
// are the `#sidebar`, `#topbar` and default slots here. The layout follows from
// whether #sidebar was given at all: with a sidebar the grid is
// `var(--sidebar-w) 1fr`, without one `.bs-shell--topnav` collapses it to a single
// full-width column, which is the top-nav layout from guidelines/ux-patterns.md.
// Never both at once — that rule is structural here, not a convention: there is one
// sidebar slot and the class is derived from it.
//
// To switch layouts at runtime put the condition on the slot itself
// (`<template v-if="layout === 'sidebar'" #sidebar>`); Vue then omits the slot
// function entirely and the shell drops to the top-nav grid.
//
// `--content-max` currently ships as `100%`, so `.bs-shell__content` is full-bleed
// even though the UX guidelines say 1280px. That contradiction is a token decision
// (the internal design-system findings log, finding 2) and is deliberately not patched here.
const props = withDefaults(defineProps<{
    /** Narrows the sidebar column to `--sidebar-w-collapsed`. Pass the same value to BsSidebarNav. */
    collapsed?: boolean
}>(), {
    collapsed: false,
})

const slots = useSlots()

const classes = computed(() => [
    'bs-shell',
    slots.sidebar ? '' : 'bs-shell--topnav',
    props.collapsed ? 'bs-shell--collapsed' : '',
].filter(Boolean))

// a11y, beyond the reference: the content region is the page's main landmark, so it
// is a real <main> rather than the reference's <div>. layout/PageLayout.vue already
// documents itself as "the page's <main> when there is no AppShell around it", so
// the two do not nest — a screen inside AppShell uses BsSection/BsPageHeader, not
// BsPageLayout.
//
// `collapsed` is passed down as a slot prop purely as a convenience: the reference
// makes the caller thread the same flag into both AppShell and SidebarNav, and
// `<template #sidebar="{ collapsed }">` lets it be threaded once.
</script>

<template>
    <div :class="classes">
        <slot
            name="sidebar"
            :collapsed="collapsed"
        />
        <div class="bs-shell__main">
            <slot
                name="topbar"
                :collapsed="collapsed"
            />
            <main class="bs-shell__content">
                <slot />
            </main>
        </div>
    </div>
</template>
