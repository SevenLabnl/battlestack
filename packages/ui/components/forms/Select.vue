<script setup lang="ts">
import { computed, inject, useAttrs, type StyleValue } from 'vue'
import Icon from '../icons/Icon.vue'
import { formFieldKey } from './FormField.vue'

interface SelectOption {
    value: string
    label: string
    disabled?: boolean
}

// Port of components/forms/Select.jsx. Deliberately a native <select>: the
// vendored CSS styles the element itself (.bs-select), and native beats a
// scripted listbox on mobile and inside a real form. Combobox is the one to
// reach for when the list needs filtering.
//
// inheritAttrs is off because, as in the reference, the class belongs to the
// <select> while `style` belongs to the .bs-inputwrap that positions the chevron.
defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
    /** Options list; or pass <option> children through the default slot instead. */
    options?: SelectOption[]
    placeholder?: string
    size?: 'sm' | 'md' | 'lg'
    /** Error styling + aria-invalid. Set for you when the FormField has an error. */
    invalid?: boolean
}>(), {
    options: undefined,
    placeholder: undefined,
    size: 'md',
    invalid: false,
})

const model = defineModel<string>()

const attrs = useAttrs()
const field = inject(formFieldKey, null)

const classes = computed(() => [
    'bs-input',
    'bs-select',
    props.size !== 'md' ? `bs-input--${props.size}` : '',
])
const invalid = computed(() => props.invalid || !!field?.invalid.value)
const fieldId = computed(() => (field ? field.id.value : attrs.id as string | undefined))
const describedBy = computed(() => (field ? field.describedBy.value : attrs['aria-describedby'] as string | undefined))
const wrapStyle = computed(() => attrs.style as StyleValue)

// The reference gives an unbound select `defaultValue=""` so the placeholder is
// what shows. Here the same job falls to the model proxy: with no value chosen,
// the empty placeholder option is the selected one.
const selected = computed({
    get: () => (model.value === undefined && props.placeholder !== undefined ? '' : model.value),
    set: (value) => {
        model.value = value
    },
})

const selectBind = computed(() => {
    const { style: _style, ...rest } = attrs
    return rest
})
</script>

<template>
    <div
        class="bs-inputwrap"
        :style="wrapStyle"
    >
        <select
            v-bind="selectBind"
            :id="fieldId"
            v-model="selected"
            :class="classes"
            :aria-invalid="invalid || undefined"
            :aria-describedby="describedBy"
        >
            <option
                v-if="placeholder"
                value=""
                disabled
            >
                {{ placeholder }}
            </option>
            <template v-if="options">
                <option
                    v-for="option in options"
                    :key="option.value"
                    :value="option.value"
                    :disabled="option.disabled"
                >
                    {{ option.label }}
                </option>
            </template>
            <slot v-else />
        </select>
        <Icon
            name="chevron-down"
            :size="16"
        />
    </div>
</template>
