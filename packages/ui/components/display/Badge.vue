<script setup lang="ts">
import { computed } from 'vue'

// Port of components/display/Badge.jsx.
// A badge communicates status, so the status is never carried by colour alone:
// the default slot always states it in words and the dot is purely decorative
// (aria-hidden, painted with currentColor by the vendored CSS).
const props = withDefaults(defineProps<{
    tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'
    /** Leading status dot. */
    dot?: boolean
}>(), {
    tone: 'neutral',
    dot: false,
})

const classes = computed(() => ['bs-badge', `bs-badge--${props.tone}`])
</script>

<template>
    <span :class="classes">
        <span
            v-if="dot"
            class="bs-badge__dot"
            aria-hidden="true"
        />
        <slot />
    </span>
</template>
