<script setup lang="ts">
import { computed, inject, ref, useAttrs, useSlots, type StyleValue } from 'vue'
import { formFieldKey } from './FormField.vue'

// Port of components/forms/Input.jsx. Prop and size names come literally from
// Input.d.ts; `value` + `onChange` become v-model, and the leadingIcon /
// trailingIcon ReactNode props become slots.
//
// inheritAttrs is off because the reference splits the incoming attributes: the
// class always belongs to the <input>, while `style` moves to the .bs-inputwrap
// wrapper whenever an icon is present. Vue's default fallthrough would put both
// on the root element, which in that case is the wrapper.
defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
    size?: 'sm' | 'md' | 'lg'
    /** Error styling + aria-invalid. Set for you when the FormField has an error. */
    invalid?: boolean
}>(), {
    size: 'md',
    invalid: false,
})

const model = defineModel<string | number>()

const attrs = useAttrs()
const slots = useSlots()
const field = inject(formFieldKey, null)
const el = ref<HTMLInputElement | null>(null)

const wrapped = computed(() => !!slots.leadingIcon || !!slots.trailingIcon)
const invalid = computed(() => props.invalid || !!field?.invalid.value)

// `size !== 'md'` mirrors the reference: md is the base class, not a modifier.
const classes = computed(() => [
    'bs-input',
    props.size !== 'md' ? `bs-input--${props.size}` : '',
    slots.leadingIcon ? 'bs-input--leading' : '',
    slots.trailingIcon ? 'bs-input--trailing' : '',
].filter(Boolean))

const wrapStyle = computed(() => attrs.style as StyleValue)

// One object for both branches of the template, so the wrapped and unwrapped
// inputs cannot drift apart.
const inputBind = computed(() => {
    const { class: attrClass, style, ...rest } = attrs
    const bound: Record<string, unknown> = {
        ...rest,
        'class': [classes.value, attrClass],
        'aria-invalid': invalid.value || undefined,
    }
    if (!wrapped.value) bound.style = style
    // The FormField wins over an id of our own: it is what its <label> points at.
    if (field) {
        bound.id = field.id.value
        bound['aria-describedby'] = field.describedBy.value
    }
    // Only bind `value` when v-model is in play, so a plain `value` attribute
    // keeps behaving the way it does on a bare <input>.
    if (model.value !== undefined) bound.value = model.value
    return bound
})

function onInput(event: Event) {
    model.value = (event.target as HTMLInputElement).value
}

defineExpose({
    /** The underlying <input>, standing in for the reference's forwarded ref. */
    el,
    focus: () => el.value?.focus(),
})
</script>

<template>
    <div
        v-if="wrapped"
        class="bs-inputwrap"
        :style="wrapStyle"
    >
        <slot name="leadingIcon" />
        <input
            ref="el"
            v-bind="inputBind"
            @input="onInput"
        />
        <slot name="trailingIcon" />
    </div>
    <input
        v-else
        ref="el"
        v-bind="inputBind"
        @input="onInput"
    />
</template>
