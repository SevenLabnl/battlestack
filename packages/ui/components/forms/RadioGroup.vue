<script setup lang="ts">
import Radio from './Radio.vue'

interface RadioGroupOption {
    value: string
    label: string
    description?: string
    disabled?: boolean
}

// Port of the RadioGroup export in components/forms/Radio.jsx.
//
// Coordination is by explicit props, not provide/inject: the contract in
// Radio.d.ts is `options`, so the group renders its own children and already
// holds every value it needs to pass down. Injection would only earn its keep if
// the radios arrived through a slot, where the group cannot reach them.
//
// No key handling here either. Arrow keys, wrap-around and the single tab stop
// are what the browser does with a set of same-named radios; reimplementing that
// would only take behaviour away from the platform.
withDefaults(defineProps<{
    legend?: string
    /** Shared name: what makes the browser treat these as one group. */
    name: string
    options?: RadioGroupOption[]
    /** Disables every option; an option can also disable itself. */
    disabled?: boolean
}>(), {
    legend: undefined,
    options: () => [],
    disabled: false,
})

const model = defineModel<string>()
</script>

<template>
    <fieldset class="bs-radiogroup">
        <legend
            v-if="legend || $slots.legend"
            class="bs-label bs-radiogroup__legend"
        >
            <slot name="legend">
                {{ legend }}
            </slot>
        </legend>
        <Radio
            v-for="option in options"
            :key="option.value"
            v-model="model"
            :name="name"
            :value="option.value"
            :label="option.label"
            :description="option.description"
            :disabled="disabled || option.disabled"
        />
    </fieldset>
</template>
