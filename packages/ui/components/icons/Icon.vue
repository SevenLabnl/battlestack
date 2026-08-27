<script setup lang="ts">
import { computed } from 'vue'
import { FALLBACK_ICON, ICON_PATHS, type IconName } from './paths'

// Port of components/icons/Icon.jsx. Prop names and defaults are literally those of
// Icon.d.ts. `className` / `style` are not props: native class and style fall through.
//
// `name` is typed as the union of the registry keys so consumers get autocomplete;
// the `(string & {})` arm keeps the `name: string` contract from the .d.ts intact for
// names computed at runtime, which then fall back to help-circle exactly as the
// reference does.
const props = withDefaults(defineProps<{
    /** Glyph name from the registry in ./paths.ts, e.g. 'search', 'check', 'alert-circle'. */
    name: IconName | (string & {})
    /** Pixel size. Use 16/20/24 (--icon-sm/md/lg). */
    size?: number
    strokeWidth?: number
    /**
     * Accessible name. Omit for decorative icons — those render aria-hidden so a
     * screen reader skips them and only the surrounding text is announced.
     */
    label?: string
}>(), {
    size: 20,
    strokeWidth: 2,
    label: undefined,
})

const paths = computed<readonly string[]>(
    () => ICON_PATHS[props.name as IconName] ?? ICON_PATHS[FALLBACK_ICON],
)
</script>

<template>
    <svg
        :width="size"
        :height="size"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        :stroke-width="strokeWidth"
        stroke-linecap="round"
        stroke-linejoin="round"
        :role="label ? 'img' : undefined"
        :aria-label="label"
        :aria-hidden="label ? undefined : true"
        focusable="false"
    >
        <path
            v-for="(d, i) in paths"
            :key="i"
            :d="d"
        />
    </svg>
</template>
