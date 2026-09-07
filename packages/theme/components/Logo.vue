<script setup lang="ts">
/**
 * Battlestack brand lockup: three-bar mark + live-type wordmark.
 *
 * Monochrome `currentColor`, so it inherits whatever surface it sits on — no
 * light/dark variants exist on purpose. The wordmark is text, never an image.
 * Scale it through `font-size` on the host element (`class="text-xl"`).
 *
 * Styled with plain scoped CSS, not Tailwind utilities: this component ships
 * from `node_modules`, which Tailwind v4's content detection does not scan, so
 * utility classes used here would never be generated into the app's CSS.
 *
 * The only component this layer ships: it is brand, not UI. Everything else
 * comes from Nuxt UI.
 */
withDefaults(defineProps<{
    /** Hide to render the mark alone (collapsed nav, favicon-sized uses). */
    wordmark?: boolean
}>(), { wordmark: true })
</script>

<template>
    <span class="bs-logo">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="bs-logo-mark">
            <rect x="7" y="2.5" width="14" height="5" rx="2.5" opacity=".45" />
            <rect x="4" y="9.5" width="17" height="5" rx="2.5" opacity=".72" />
            <rect x="1" y="16.5" width="20" height="5" rx="2.5" />
        </svg>
        <span v-if="wordmark" class="bs-logo-wordmark">Battlestack</span>
    </span>
</template>

<style scoped>
.bs-logo {
    display: inline-flex;
    align-items: center;
    gap: 0.45em;
    line-height: 1;
    color: var(--ui-text-highlighted);
}

.bs-logo-mark {
    height: 1.2em;
    width: 1.2em;
    flex-shrink: 0;
}

.bs-logo-wordmark {
    font-weight: 700;
    letter-spacing: -0.025em;
    white-space: nowrap;
}
</style>
