<script setup lang="ts">
// Port of components/display/Spinner.jsx.
// The visible ring is aria-hidden; the label is what a screen reader announces.
withDefaults(defineProps<{
    /** Diameter in px. Drives the `--sp` custom property the vendored CSS reads. */
    size?: number
    /** Announced by assistive tech while the spinner is visible. */
    label?: string
}>(), {
    size: 20,
    label: 'Loading',
})
</script>

<template>
    <span
        class="bs-spinner-wrap"
        role="status"
    >
        <span
            class="bs-spinner"
            :style="{ '--sp': `${size}px` }"
            aria-hidden="true"
        />
        <span class="bs-visually-hidden">{{ label }}</span>
    </span>
</template>
