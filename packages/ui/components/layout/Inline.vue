<script setup lang="ts">
import { computed } from 'vue'
import { spaceVal } from './Stack.vue'

// Port of components/layout/Inline.jsx — horizontal flex row for buttons, badges
// and meta items. Same split as Stack: free-form CSS values inline, the boolean
// `wrap` as a modifier class.
const props = withDefaults(defineProps<{
    gap?: number | string
    /** CSS align-items. Defaults to center — a row of controls of different heights lines up on its middle. */
    align?: string
    /** CSS justify-content. */
    justify?: string
    /** Wraps onto a new line when the row runs out of width. */
    wrap?: boolean
    as?: string
}>(), {
    gap: 2,
    align: 'center',
    justify: undefined,
    wrap: true,
    as: 'div',
})

const style = computed(() => ({
    '--bs-inline-gap': spaceVal(props.gap),
    'alignItems': props.align,
    'justifyContent': props.justify,
}))
</script>

<template>
    <component
        :is="as"
        class="bs-inline"
        :class="{ 'bs-inline--nowrap': !wrap }"
        :style="style"
    >
        <slot />
    </component>
</template>
