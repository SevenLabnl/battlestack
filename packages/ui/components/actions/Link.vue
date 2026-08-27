<script setup lang="ts">
import { computed, resolveComponent } from 'vue'
import Icon from '../icons/Icon.vue'

// Port of components/actions/Link.jsx. Prop names and defaults are literally those of
// Link.d.ts; React's `children` becomes the default slot; `className` and `style` are
// native fallthrough.
//
// `to` is a deliberate extension of Link.d.ts — findings #6. The contract declares only
// `href`, which makes every in-app link a full page load in a Nuxt app. The extension is
// additive: `href` behaves exactly as before, and `to` only ever adds a second path.
// `to` wins when both are given, because the caller asking for routed navigation is the
// more specific request.
//
// resolveComponent() rather than an import, so this file still renders outside Nuxt:
// Nuxt's component loader rewrites the call to a direct import of NuxtLink at build
// time, and anywhere else it hands back the name it was given — a string, which is the
// signal to fall back to a plain <a href>.
//
// The reference's inline style (inline-flex + gap, only meaningful when external)
// became .bs-link--external in styles/extra/actions.css, per the styling rules.
const props = withDefaults(defineProps<{
    href?: string
    /**
     * In-app destination, routed through NuxtLink instead of reloading the page.
     * Takes precedence over `href`. Any NuxtLink target: a path or a route object.
     */
    to?: string | Record<string, unknown>
    /** Opens in a new tab, marked with an external-link icon that says so. */
    external?: boolean
}>(), {
    href: '#',
    to: undefined,
    external: false,
})

const nuxtLink = resolveComponent('NuxtLink')
const routed = computed(() => props.to !== undefined && typeof nuxtLink !== 'string')

const tag = computed(() => (routed.value ? nuxtLink : 'a'))

// One or the other, never both: NuxtLink derives its own href from `to`, and an `href`
// alongside it would be a second, unrouted destination on the same anchor.
const destination = computed(() => {
    if (routed.value) return { to: props.to }
    // No router to hand it to. A string `to` is still a usable URL, so the link keeps
    // working unrouted; a route object is not one, so `href` stays what it was.
    if (typeof props.to === 'string') return { href: props.to }
    return { href: props.href }
})

const classes = computed(() => [
    'bs-link',
    props.external ? 'bs-link--external' : '',
].filter(Boolean))
</script>

<template>
    <component
        :is="tag"
        v-bind="destination"
        :class="classes"
        :target="external ? '_blank' : undefined"
        :rel="external ? 'noreferrer' : undefined"
    >
        <slot />
        <!-- Labelled, not decorative: leaving the current tab is information the
             link text does not carry, so it has to be announced. -->
        <Icon
            v-if="external"
            name="external-link"
            :size="13"
            label="Opens in new tab"
        />
    </component>
</template>
