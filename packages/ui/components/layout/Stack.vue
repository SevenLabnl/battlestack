<script setup lang="ts">
import { computed } from 'vue'

// Port of components/layout/Stack.jsx — the default way to space siblings.
// `align`/`justify` take any CSS value, so they cannot become modifier classes
// and stay inline; the gap becomes a custom property the .bs-stack class reads.
const props = withDefaults(defineProps<{
    /** Spacing step (number -> var(--space-N)) or CSS length. Default 4 (16px) */
    gap?: number | string
    /** CSS align-items. Typed as string because the macro cannot resolve CSSProperties['alignItems']. */
    align?: string
    /** CSS justify-content. */
    justify?: string
    /** Rendered element. Reference: `as` -> Tag. */
    as?: string
}>(), {
    gap: 4,
    align: undefined,
    justify: undefined,
    as: 'div',
})

const style = computed(() => ({
    '--bs-stack-gap': spaceVal(props.gap),
    'alignItems': props.align,
    'justifyContent': props.justify,
}))
</script>

<!-- The companion <script> block carries the module's one named export. It sits
     after <script setup> only so the setup block's import stays the first
     statement in the concatenated module. -->
<script lang="ts">
/**
 * A spacing step resolved against the token scale: `4` becomes `var(--space-4)`
 * (16px). A string passes through untouched so a caller can hand in any CSS
 * length the scale does not cover.
 *
 * Exported because Stack.d.ts exports it and Inline/Grid import it — Vue keeps
 * named exports from a companion <script> alongside <script setup>, which is
 * exactly the shape of the reference module.
 */
export function spaceVal(g: number | string): string {
    return typeof g === 'number' ? `var(--space-${g})` : g
}
</script>

<template>
    <component
        :is="as"
        class="bs-stack"
        :style="style"
    >
        <slot />
    </component>
</template>
