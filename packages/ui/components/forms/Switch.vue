<script setup lang="ts">
import { computed, useAttrs, useSlots, type StyleValue } from 'vue'

// Port of components/forms/Switch.jsx. Deliberately a native checkbox with
// role="switch": the vendored CSS styles the element itself (.bs-switch > input).
// A switch means the change takes effect at once — anything that needs a save
// step is a Checkbox.
//
// inheritAttrs is off for the same reason as Checkbox: class and style dress the
// <label>, the rest belongs on the <input>. Same deviation as Radio — the
// reference lets `style` fall onto the input, which reads as an oversight.
defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
    label?: string
    /** Puts the label before the track, for "Off | Switch" style rows. */
    labelBefore?: boolean
    disabled?: boolean
}>(), {
    label: undefined,
    labelBefore: false,
    disabled: false,
})

const model = defineModel<boolean>()

const attrs = useAttrs()
const slots = useSlots()

const classes = computed(() => [
    'bs-switch',
    props.disabled ? 'bs-check--disabled' : '',
    attrs.class,
])
const rootStyle = computed(() => attrs.style as StyleValue)
const hasLabel = computed(() => !!props.label || !!slots.default)

const inputBind = computed(() => {
    const { class: _class, style: _style, ...rest } = attrs
    return rest
})
</script>

<template>
    <label
        :class="classes"
        :style="rootStyle"
    >
        <span v-if="labelBefore && hasLabel"><slot>{{ label }}</slot></span>
        <input
            v-bind="inputBind"
            v-model="model"
            type="checkbox"
            role="switch"
            :disabled="disabled"
        />
        <span v-if="!labelBefore && hasLabel"><slot>{{ label }}</slot></span>
    </label>
</template>
