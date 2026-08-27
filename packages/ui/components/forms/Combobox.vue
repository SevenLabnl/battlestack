<script setup lang="ts">
import { computed, inject, ref, useAttrs, watch, type StyleValue } from 'vue'
import {
    ComboboxAnchor,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxPortal,
    ComboboxRoot,
    ComboboxTrigger,
} from 'reka-ui'
import Icon from '../icons/Icon.vue'
import { formFieldKey } from './FormField.vue'

export interface ComboboxOption {
    value: string
    label: string
}

// Port of components/forms/Combobox.jsx. Prop names, the option shape and the
// defaults come literally from Combobox.d.ts; `value` + `onChange` become v-model.
//
// The reference builds the listbox pattern by hand and only gets part of it:
// no aria-activedescendant, no Home/End, no type-ahead, an outside-click handler
// on document, and a panel that clips inside a scroll container. PORTING.md puts
// Combobox on the reka-ui list for exactly that reason, so the behaviour here is
// Reka's ARIA 1.2 combobox and every element is still ours via `as` / `as-child`:
// the classes sit on the same elements the reference puts them on.
//
// Two `as-child` choices worth knowing, both there to keep the DOM the reference's:
// - the popper anchor is the <input>, not a box around it, because the reference
//   has exactly one element here and .bs-input is full width, so the panel still
//   lines up with the wrapper's edges;
// - the chevron stays a direct child <svg> of .bs-inputwrap, which is what the
//   vendored `.bs-inputwrap > svg:last-child` rule positions. Icon renders it
//   aria-hidden, as decorative as the reference's: the state it would announce is
//   already on the input, and the trigger is tabindex="-1" either way.
//
// inheritAttrs is off for the same reason as Input and Select: the class belongs
// on the <input>, while `style` belongs on the .bs-inputwrap that positions the
// chevron — Vue's default fallthrough would put both on the wrapper.
//
// `size` is a deliberate extension of Combobox.d.ts — findings #15. Input, Select and
// Textarea all take sm | md | lg and a Combobox sits beside them in a form, so it takes
// the same three, with the same default and the same class mapping. Additive: nothing
// typed against the contract changes, since the default is the height it had before.
defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
    options?: ComboboxOption[]
    size?: 'sm' | 'md' | 'lg'
    placeholder?: string
    /** Error styling + aria-invalid. Set for you when the FormField has an error. */
    invalid?: boolean
    disabled?: boolean
}>(), {
    options: () => [],
    size: 'md',
    placeholder: 'Select…',
    invalid: false,
    disabled: false,
})

const model = defineModel<string | null>({ default: null })

const attrs = useAttrs()
const field = inject(formFieldKey, null)

const open = ref(false)
/** What the <input> is showing: the query while open, the selected label while closed. */
const search = ref('')

const invalid = computed(() => props.invalid || !!field?.invalid.value)
// The FormField wins over an id of our own: it is what its <label> points at.
const fieldId = computed(() => (field ? field.id.value : attrs.id as string | undefined))
const describedBy = computed(() => (field ? field.describedBy.value : attrs['aria-describedby'] as string | undefined))
const wrapStyle = computed(() => attrs.style as StyleValue)

// Reka reads '' as "nothing selected", which is what the reference's null means.
const selection = computed(() => model.value ?? '')

const emptyText = computed(() => (search.value ? `No matches for “${search.value}”` : 'No options'))

// `size !== 'md'` mirrors Input and Select: md is the base class, not a modifier.
const inputBind = computed(() => {
    const { class: attrClass, style: _style, id: _id, 'aria-describedby': _describedBy, ...rest } = attrs
    return {
        ...rest,
        class: [
            'bs-input',
            props.size !== 'md' ? `bs-input--${props.size}` : '',
            'bs-input--trailing',
            attrClass,
        ].filter(Boolean),
    }
})

/** Label for a value, so the closed input reads as the reference's does. */
function displayValue(value: unknown) {
    return props.options.find((option) => option.value === value)?.label ?? ''
}

function onSelect(value: unknown) {
    model.value = (value as string | null | undefined) || null
}

// The reference blanks the field the moment the list opens (`value={open ? query
// : label}`) so the placeholder shows and typing starts a fresh query. Reka
// resets the term itself on select and on close; only the open edge is ours.
watch(open, (isOpen) => {
    if (isOpen) search.value = ''
})
</script>

<template>
    <ComboboxRoot
        v-model:open="open"
        as="div"
        class="bs-inputwrap"
        :style="wrapStyle"
        :model-value="selection"
        :disabled="disabled"
        open-on-focus
        open-on-click
        @update:model-value="onSelect"
    >
        <ComboboxAnchor as-child>
            <ComboboxInput
                v-bind="inputBind"
                :id="fieldId"
                v-model="search"
                :display-value="displayValue"
                :placeholder="placeholder"
                :aria-describedby="describedBy"
                :aria-invalid="invalid || undefined"
            />
        </ComboboxAnchor>
        <ComboboxTrigger
            as="span"
            as-child
        >
            <Icon
                name="chevrons-up-down"
                :size="15"
                class="bs-combobox__toggle"
            />
        </ComboboxTrigger>
        <ComboboxPortal>
            <ComboboxContent
                as="ul"
                class="bs-listbox bs-listbox--fixed"
                position="popper"
                align="start"
                :side-offset="4"
            >
                <ComboboxEmpty
                    as="li"
                    class="bs-listbox__none"
                >
                    {{ emptyText }}
                </ComboboxEmpty>
                <ComboboxItem
                    v-for="option in options"
                    :key="option.value"
                    as="li"
                    class="bs-listbox__opt"
                    :value="option.value"
                    :text-value="option.label"
                >
                    <span>{{ option.label }}</span>
                    <Icon
                        v-if="option.value === model"
                        name="check"
                        :size="15"
                    />
                </ComboboxItem>
            </ComboboxContent>
        </ComboboxPortal>
    </ComboboxRoot>
</template>
