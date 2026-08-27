<script setup lang="ts">
import { computed } from 'vue'
import Icon from '../icons/Icon.vue'

// Port of components/patterns/StatCard.jsx. Prop names and the deltaDir values
// come literally from StatCard.d.ts; `label`, `value`, `delta` and `hint` are
// ReactNodes there and keep a string shorthand alongside their slot, because the
// reference only ever passes text.
//
// The exact number leads — `.bs-stat__value` is the tabular-nums display size,
// and everything else is subordinate to it. Direction is never colour alone: the
// green/red only ever accompanies an arrow glyph plus the word "increase" or
// "decrease" in the accessible name.
const props = withDefaults(defineProps<{
    /** What is being counted. Required — a bare number names nothing. */
    label: string
    /** The number itself. Pre-format it — the card does not know its unit. */
    value: string | number
    /** Change over the comparison period, e.g. "+12.4%". */
    delta?: string
    deltaDir?: 'up' | 'down' | 'flat'
    /** Comparison caption, e.g. "vs last 30 days". */
    hint?: string
}>(), {
    delta: undefined,
    deltaDir: 'flat',
    hint: undefined,
})

const dirClass = computed(() => ({
    up: 'bs-stat__delta--up',
    down: 'bs-stat__delta--down',
    flat: '',
}[props.deltaDir]))

const dirIcon = computed(() => ({
    up: 'arrow-up-right',
    down: 'arrow-down-right',
    flat: null,
}[props.deltaDir]))

const dirText = computed(() => ({
    up: 'increase',
    down: 'decrease',
    flat: '',
}[props.deltaDir]))
</script>

<template>
    <div class="bs-card">
        <div class="bs-stat">
            <span class="bs-stat__label">
                <slot name="label">{{ label }}</slot>
            </span>
            <span class="bs-stat__value">
                <slot name="value">{{ value }}</slot>
            </span>
            <span
                v-if="delta || hint || $slots.delta || $slots.hint"
                class="bs-stat__delta"
            >
                <span
                    v-if="delta || $slots.delta"
                    class="bs-stat__delta"
                    :class="dirClass"
                >
                    <Icon
                        v-if="dirIcon"
                        :name="dirIcon"
                        :size="14"
                    />
                    <slot name="delta">{{ delta }}</slot>
                    <span
                        v-if="dirText"
                        class="bs-visually-hidden"
                    >{{ dirText }}</span>
                </span>
                <span
                    v-if="hint || $slots.hint"
                    class="bs-caption"
                >
                    <slot name="hint">{{ hint }}</slot>
                </span>
            </span>
        </div>
    </div>
</template>
