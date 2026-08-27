<script setup lang="ts">
import { computed } from 'vue'
import Spinner from '../display/Spinner.vue'

// Port of components/actions/Button.jsx. Prop names, variants and sizes are kept
// literally identical to Button.d.ts — that contract has to hold across clients.
// React's `icon` / `iconAfter` ReactNode props become slots (see the mapping table
// in the architecture plan); everything else is a straight prop.
const props = withDefaults(defineProps<{
    /** primary = one per view; secondary = default alternative; ghost = low emphasis; danger = destructive */
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'sm' | 'md' | 'lg'
    /** Swaps the icon slot for a spinner, blocks pointer events and sets aria-busy. */
    loading?: boolean
    block?: boolean
    type?: 'button' | 'submit' | 'reset'
}>(), {
    variant: 'primary',
    size: 'md',
    loading: false,
    block: false,
    type: 'button',
})

// `size !== 'md'` mirrors the reference: md is the base class, not a modifier.
const classes = computed(() => [
    'bs-btn',
    `bs-btn--${props.variant}`,
    props.size !== 'md' ? `bs-btn--${props.size}` : '',
    props.block ? 'bs-btn--block' : '',
    props.loading ? 'bs-btn--loading' : '',
].filter(Boolean))
</script>

<template>
    <button
        :type="type"
        :class="classes"
        :aria-busy="loading || undefined"
    >
        <Spinner
            v-if="loading"
            :size="14"
        />
        <slot
            v-else
            name="icon"
        />
        <slot />
        <slot name="iconAfter" />
    </button>
</template>
