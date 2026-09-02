<script setup lang="ts">
/**
 * Battlestack brand lockup: three-bar mark + live-type wordmark.
 *
 * Monochrome `currentColor`, so it inherits whatever surface it sits on — no
 * light/dark variants exist on purpose. The wordmark is text, never an image.
 * Scale it through `font-size` on the host element (`class="text-xl"`).
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
    <span class="inline-flex items-center gap-[0.45em] text-highlighted" style="line-height: 1">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="h-[1.2em] w-[1.2em] shrink-0">
            <rect x="7" y="2.5" width="14" height="5" rx="2.5" opacity=".45" />
            <rect x="4" y="9.5" width="17" height="5" rx="2.5" opacity=".72" />
            <rect x="1" y="16.5" width="20" height="5" rx="2.5" />
        </svg>
        <span v-if="wordmark" class="font-bold tracking-[-0.025em] whitespace-nowrap">Battlestack</span>
    </span>
</template>
