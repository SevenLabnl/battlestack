<script setup lang="ts">
import { computed, useSlots } from 'vue'

// Port of components/patterns/TopNav.jsx — the sticky `--topbar-h` bar. It has no
// props of its own: `children` and `actions` are ReactNode in TopNav.d.ts, so they
// are the default and `#actions` slots, and `style` is native attribute
// fallthrough. `.bs-topnav` and `.bs-topnav__spacer` come from
// styles/vendor/patterns.css; only the actions row was an inline style in the
// reference, and it is `.bs-topnav__actions` in styles/extra/patterns-shell.css.
//
// It stays a <header>, not a <nav>. The bar is the page's banner — breadcrumbs, a
// search field, notification and account controls — and the navigation landmark
// inside it is BsHorizontalNav's own <nav>. In the top-nav layout the bar is the
// only chrome there is, so making the bar itself a nav would name the account menu
// and the search box as navigation too.
const slots = useSlots()

const hasActions = computed(() => Boolean(slots.actions))
</script>

<template>
    <header class="bs-topnav">
        <slot />
        <div class="bs-topnav__spacer" />
        <div
            v-if="hasActions"
            class="bs-topnav__actions"
        >
            <slot name="actions" />
        </div>
    </header>
</template>
