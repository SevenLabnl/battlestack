<script setup lang="ts">
import { computed, ref, type StyleValue, useAttrs, useSlots, watchPostEffect } from 'vue'

// Port of components/forms/Checkbox.jsx. Deliberately a native <input
// type="checkbox">: the vendored CSS styles the element itself (.bs-check > input).
//
// inheritAttrs is off because the reference splits the attributes — class and
// style dress the <label>, while everything else (name, value, required,
// aria-*) has to reach the <input> that carries the state.
defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
    label?: string
    description?: string
    /** Neither checked nor unchecked — the "some of these" state of a select-all. */
    indeterminate?: boolean
    disabled?: boolean
}>(), {
    label: undefined,
    description: undefined,
    indeterminate: false,
    disabled: false,
})

const model = defineModel<boolean>()

const attrs = useAttrs()
const slots = useSlots()
const input = ref<HTMLInputElement | null>(null)

const classes = computed(() => [
    'bs-check',
    props.disabled ? 'bs-check--disabled' : '',
    attrs.class,
])
const rootStyle = computed(() => attrs.style as StyleValue)
const hasLabel = computed(() => !!props.label || !!slots.default)
const hasDescription = computed(() => !!props.description || !!slots.description)

const inputBind = computed(() => {
    const { class: _class, style: _style, ...rest } = attrs
    return rest
})

// `indeterminate` is a DOM property with no matching attribute, so it can only be
// set on the element. Mirrors the reference's effect, including the fact that a
// click clearing it does not force it back on.
//
// Post-flush, not the default pre-flush: a plain watchEffect runs before the input
// ref is populated, so the first pass is a no-op and the state only lands a tick
// later. Invisible in a browser, but a select-all's indeterminate state was then
// wrong for one tick after mount.
watchPostEffect(() => {
    if (input.value) input.value.indeterminate = props.indeterminate
})
</script>

<template>
    <label
        :class="classes"
        :style="rootStyle"
    >
        <input
            ref="input"
            v-bind="inputBind"
            v-model="model"
            type="checkbox"
            :disabled="disabled"
        />
        <span
            v-if="hasLabel || hasDescription"
            class="bs-check__text"
        >
            <span><slot>{{ label }}</slot></span>
            <span
                v-if="hasDescription"
                class="bs-small bs-check__desc"
            >
                <slot name="description">{{ description }}</slot>
            </span>
        </span>
    </label>
</template>
