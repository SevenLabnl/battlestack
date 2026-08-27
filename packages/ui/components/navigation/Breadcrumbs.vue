<script setup lang="ts">
import Icon from '../icons/Icon.vue'

interface Crumb {
    label: string
    href?: string
    onClick?: (event: MouseEvent) => void
}

// Port of components/navigation/Breadcrumbs.jsx. `items` and the Crumb shape keep
// the spelling from Breadcrumbs.d.ts, `onClick` included — it is part of the item
// contract, not a component-level event.
//
// The trail shows where the user is, so the last crumb is the page itself: it is
// marked aria-current="page" and is not a link, because a link to the page you
// are already on is a dead end.
withDefaults(defineProps<{
    items?: Crumb[]
}>(), {
    items: () => [],
})
</script>

<template>
    <nav aria-label="Breadcrumb">
        <ol class="bs-breadcrumbs">
            <li
                v-for="(item, i) in items"
                :key="i"
                class="bs-breadcrumbs__item"
            >
                <Icon
                    v-if="i > 0"
                    name="chevron-right"
                    :size="14"
                />
                <span
                    v-if="i === items.length - 1"
                    aria-current="page"
                >{{ item.label }}</span>
                <a
                    v-else
                    :href="item.href || '#'"
                    @click="item.onClick?.($event)"
                >{{ item.label }}</a>
            </li>
        </ol>
    </nav>
</template>
