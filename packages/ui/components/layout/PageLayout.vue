<script setup lang="ts">
import { computed } from 'vue'

// Port of components/layout/PageLayout.jsx — the page's <main> when there is no
// AppShell around it.
const props = withDefaults(defineProps<{
    /**
     * Any CSS max-width. Defaults to the page-width token rather than the
     * reference's hardcoded 1280px, so a standalone page and AppShell's
     * .bs-shell__content (which reads the same token) stay in step when a theme
     * retunes it.
     */
    maxWidth?: string
    padding?: string
}>(), {
    maxWidth: 'var(--content-max)',
    padding: 'var(--space-6)',
})

// Both are free-form CSS lengths chosen per page, so neither can be a class.
const style = computed(() => ({
    '--bs-pagelayout-max': props.maxWidth,
    '--bs-pagelayout-pad': props.padding,
}))
</script>

<template>
    <main
        class="bs-pagelayout"
        :style="style"
    >
        <slot />
    </main>
</template>
