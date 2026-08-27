<script setup lang="ts">
import { computed, useAttrs, useSlots, type StyleValue } from 'vue'

// Port of the Radio export in components/forms/Radio.jsx. Deliberately a native
// <input type="radio">: arrow-key movement inside a group, form submission and
// the vendored .bs-check > input styling all come for free.
//
// The radio's own value stays a plain attribute (`value`), the way it is on a
// native input; `modelValue` is the value the whole group holds. inheritAttrs is
// off for the same reason as Checkbox: class and style dress the <label>, the
// rest belongs on the <input>.
//
// Deviation: the reference leaves `style` in the rest spread, so it lands on the
// input. That looks like an oversight — its sibling Checkbox puts style on the
// label — so style dresses the label here too.
defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
    label?: string
    description?: string
    disabled?: boolean
}>(), {
    label: undefined,
    description: undefined,
    disabled: false,
})

const model = defineModel<string>()

const attrs = useAttrs()
const slots = useSlots()

const classes = computed(() => [
    'bs-check',
    'bs-radio',
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
</script>

<template>
    <label
        :class="classes"
        :style="rootStyle"
    >
        <input
            v-bind="inputBind"
            v-model="model"
            type="radio"
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
