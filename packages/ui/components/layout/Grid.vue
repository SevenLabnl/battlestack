<script setup lang="ts">
import { computed } from 'vue'
import { spaceVal } from './Stack.vue'

// Port of components/layout/Grid.jsx.
const props = withDefaults(defineProps<{
    /** Fixed column count, or any grid-template-columns string */
    cols?: number | string
    /** Responsive min column width -> repeat(auto-fill,minmax(min,1fr)) */
    min?: string
    gap?: number | string
}>(), {
    cols: undefined,
    min: undefined,
    gap: 4,
})

// `min` wins over `cols`, as in the reference; with neither the grid is two
// even columns. The min() guard keeps a column from overflowing a container
// narrower than the requested minimum.
const template = computed(() => {
    if (props.min) return `repeat(auto-fill,minmax(min(${props.min},100%),1fr))`
    if (typeof props.cols === 'number') return `repeat(${props.cols},minmax(0,1fr))`
    return props.cols || 'repeat(2,minmax(0,1fr))'
})

// The template and the gap are per instance by definition, so both are inline
// custom properties rather than a combinatorial explosion of modifier classes.
const style = computed(() => ({
    '--bs-grid-cols': template.value,
    '--bs-grid-gap': spaceVal(props.gap),
}))
</script>

<template>
    <div
        class="bs-grid"
        :style="style"
    >
        <slot />
    </div>
</template>
