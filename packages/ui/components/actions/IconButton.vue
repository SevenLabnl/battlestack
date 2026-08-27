<script setup lang="ts">
import { computed } from 'vue'

// Port of components/actions/IconButton.jsx. Prop names, variants and sizes are kept
// literally identical to IconButton.d.ts. React's `children` (the icon) becomes the
// default slot; `className` is native class fallthrough.
//
// `label` is required: an icon-only control has no text to name it, so the label is
// the only accessible name there is. It lands on aria-label (assistive tech) and on
// title (pointer users get the same word as a tooltip), as the reference does.
const props = withDefaults(defineProps<{
    /** Required accessible name — becomes aria-label and title. */
    label: string
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'sm' | 'md' | 'lg'
}>(), {
    variant: 'ghost',
    size: 'md',
})

// `size !== 'md'` mirrors the reference: md is the base class, not a modifier.
const classes = computed(() => [
    'bs-btn',
    'bs-iconbtn',
    `bs-btn--${props.variant}`,
    props.size !== 'md' ? `bs-btn--${props.size}` : '',
].filter(Boolean))

// `type="button"` is set in the template rather than declared as a prop: fallthrough
// attrs are applied after the template's own, so `<BsIconButton type="submit">` still
// overrides it, matching the reference's `{...rest}`-after-`type` spread.
//
// The note lives here, not above the root element: a comment before the root makes the
// component multi-root in dev builds, which silently drops attribute fallthrough
// altogether. Verified — it was doing exactly that.
</script>

<template>
    <button
        type="button"
        :class="classes"
        :aria-label="label"
        :title="label"
    >
        <slot />
    </button>
</template>
