<script setup lang="ts">
import { computed } from 'vue'

// Port of components/layout/Container.jsx.
// The reference resolved `size` against a lookup and fell through to the raw
// value: `{sm:640px,…}[size] || size`. Here the five named sizes are modifier
// classes (their widths live in styles/extra/layout.css, so the raw px sit in
// one place) and only an arbitrary CSS width lands inline.
const props = withDefaults(defineProps<{
    /**
     * "sm"(640) | "md"(820) | "lg"(1080) | "xl"(1280) | "full" | any CSS width.
     * The `& {}` keeps the five names in autocomplete: a bare `… | string`
     * collapses the whole union to `string` and the hints disappear.
     */
    size?: 'sm' | 'md' | 'lg' | 'xl' | 'full' | (string & {})
}>(), {
    size: 'lg',
})

const NAMED_SIZES = ['sm', 'md', 'lg', 'xl', 'full']

const isNamed = computed(() => NAMED_SIZES.includes(props.size))
</script>

<template>
    <div
        class="bs-container"
        :class="isNamed ? `bs-container--${size}` : undefined"
        :style="isNamed ? undefined : { '--bs-container-max': size }"
    >
        <slot />
    </div>
</template>
