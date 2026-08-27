<script setup lang="ts">
// The Battlestack lockup: the three-bar stacked mark plus the wordmark set as
// live type. Geometry and spacing come from the export's own specimen
// (guidelines/wordmark.html): gap 11px, weight 700, tracking -.025em, and a mark
// sized a little larger than the type.
//
// It lives in the **theme** package, not in @sevenlab/ui. Brand identity is
// precisely what a client theme replaces, so the component library never learns
// a brand — a client theme ships its own assets/ and its own BrandLockup.vue,
// and the layer that extends this one wins.
//
// Everything is currentColor by design, so the lockup inherits whatever surface
// it sits on. That is why there is no light/dark variant, and why the ink sidebar
// and a white top bar can use the same component.
withDefaults(defineProps<{
    /** Wordmark font size in px. The mark scales with it. */
    size?: number
    /** Mark without the wordmark — for a collapsed sidebar rail. */
    markOnly?: boolean
    /** The wordmark text. A client theme passes its own product name. */
    name?: string
}>(), {
    size: 19,
    markOnly: false,
    name: 'Battlestack',
})
</script>

<template>
    <span
        class="bs-brand"
        :class="{ 'bs-brand--mark-only': markOnly }"
        :style="{ fontSize: `${size}px` }"
        :role="markOnly ? 'img' : undefined"
        :aria-label="markOnly ? name : undefined"
    >
        <!-- aria-hidden when the wordmark is present: the live text already carries
             the name, and announcing both would read the brand twice. -->
        <svg
            class="bs-brand__mark"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
        >
            <rect
                x="7"
                y="2.5"
                width="14"
                height="5"
                rx="2.5"
                opacity=".45"
            />
            <rect
                x="4"
                y="9.5"
                width="17"
                height="5"
                rx="2.5"
                opacity=".72"
            />
            <rect
                x="1"
                y="16.5"
                width="20"
                height="5"
                rx="2.5"
            />
        </svg>
        <span
            v-if="!markOnly"
            class="bs-brand__word"
        >{{ name }}</span>
    </span>
</template>

<style>
/* Not scoped: a client theme overriding this component should be able to restyle
   the lockup from its own CSS without fighting a generated attribute selector. */
.bs-brand {
    display: inline-flex;
    align-items: center;
    /* 11px at the specimen's sizes. Off the 4px grid on purpose — it is brand
       geometry from guidelines/wordmark.html, not layout spacing. */
    gap: 11px;
    font-weight: var(--weight-bold);
    letter-spacing: -0.025em;
    line-height: 1;
    color: inherit;
}

.bs-brand__mark {
    display: block;
    flex: none;
    /* The specimen draws the mark slightly larger than the cap height so the
       stack reads as a peer of the wordmark rather than a bullet before it. */
    width: 1.16em;
    height: 1.16em;
}

.bs-brand--mark-only {
    gap: 0;
}
</style>
