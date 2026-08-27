<script setup lang="ts">
import { computed } from 'vue'

// Port of components/display/Skeleton.jsx. Always decorative: a skeleton is
// aria-hidden and the region it stands in announces its own loading state.
// The pulse is paused under prefers-reduced-motion by the vendored base CSS.
const props = withDefaults(defineProps<{
    variant?: 'block' | 'text' | 'circle'
    width?: number | string
    height?: number | string
    /** For variant "text": number of lines. The last one is 60% wide. */
    lines?: number
}>(), {
    variant: 'block',
    width: undefined,
    height: undefined,
    lines: 1,
})

// React turns a bare number into px on its own; Vue does not. Fallbacks stay
// numbers here rather than '32px' strings, so the reference's `height || width || 32`
// reads the same and the px is computed rather than written literally.
function len(value: number | string | undefined, fallback?: number | string): string | undefined {
    const raw = value || fallback
    if (raw === undefined) return undefined
    return typeof raw === 'number' ? `${raw}px` : raw
}

const multiline = computed(() => props.variant === 'text' && props.lines > 1)

const classes = computed(() => [
    'bs-skel',
    props.variant === 'text' ? 'bs-skel--text' : '',
    props.variant === 'circle' ? 'bs-skel--circle' : '',
].filter(Boolean))

// A circle is square: height falls back to width, then to 32. A text line
// leaves height to `.bs-skel--text`.
const dimensions = computed(() => {
    if (props.variant === 'circle') {
        return {
            width: len(props.width, 32),
            height: len(props.height || props.width, 32),
        }
    }
    return {
        width: len(props.width, '100%'),
        height: props.variant === 'text' ? undefined : len(props.height, 16),
    }
})

function lineWidth(index: number): string | undefined {
    return index === props.lines - 1 ? '60%' : len(props.width, '100%')
}
</script>

<template>
    <div
        v-if="multiline"
        class="bs-skel-lines"
        aria-hidden="true"
    >
        <span
            v-for="line in lines"
            :key="line"
            class="bs-skel bs-skel--text"
            :style="{ width: lineWidth(line - 1) }"
        />
    </div>
    <span
        v-else
        :class="classes"
        :style="dimensions"
        aria-hidden="true"
    />
</template>
