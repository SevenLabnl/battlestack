<script setup lang="ts">
import { computed, useAttrs, type StyleValue } from 'vue'

// Port of components/display/Table.jsx. The low-level table: the caller writes
// thead/tbody. Sorting, selection and pagination belong to DataTable.
const props = withDefaults(defineProps<{
    compact?: boolean
    /** Row hover background. */
    hover?: boolean
    /** Render without the bordered scroll wrapper. */
    bare?: boolean
}>(), {
    compact: false,
    hover: false,
    bare: false,
})

// inheritAttrs: false because the wrapper is not the element attrs belong to.
// The reference puts `className` and the rest props on the <table> and only
// `style` on the wrapper — the wrapper is the scroll box, so a caller's sizing
// style is aimed at it. Splitting them keeps that behaviour.
defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

const wrapperStyle = computed(() => attrs.style as StyleValue)

const tableAttrs = computed(() => {
    if (props.bare) return attrs
    const { style: _style, ...rest } = attrs
    return rest
})

const classes = computed(() => [
    'bs-table',
    props.compact ? 'bs-table--compact' : '',
    props.hover ? 'bs-table--hover' : '',
].filter(Boolean))
</script>

<template>
    <table
        v-if="bare"
        :class="classes"
        v-bind="tableAttrs"
    >
        <slot />
    </table>
    <div
        v-else
        class="bs-tablewrap"
        :style="wrapperStyle"
    >
        <table
            :class="classes"
            v-bind="tableAttrs"
        >
            <slot />
        </table>
    </div>
</template>
