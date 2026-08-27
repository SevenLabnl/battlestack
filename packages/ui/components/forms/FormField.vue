<script lang="ts">
import type { ComputedRef, InjectionKey } from 'vue'

/**
 * What FormField hands down to the control it wraps.
 *
 * The React reference does this with `cloneElement`, injecting `id`, `invalid`
 * and `aria-describedby` into its single child. Vue has no cloneElement, so the
 * wiring travels through provide/inject instead: the control asks for it, rather
 * than the field reaching into it. Input, Textarea and Select consume this key.
 *
 * Two consequences worth knowing:
 * - Like the reference (`children: React.ReactElement`), a FormField wires exactly
 *   one control. Put two controls in the slot and both would claim the same id;
 *   wire the second one by hand from the slot props instead.
 * - Anything that is not a Bs form control (a third-party editor, Combobox before
 *   it lands) can still be wired manually: the default slot exposes the same
 *   `id` / `invalid` / `describedBy` as slot props.
 */
export interface FormFieldContext {
    /** Id the label points at. The control must adopt it. */
    id: ComputedRef<string>
    /** True while the field is showing a validation message. */
    invalid: ComputedRef<boolean>
    /** Ids of the error/helper text, ready for aria-describedby. */
    describedBy: ComputedRef<string | undefined>
}

export const formFieldKey: InjectionKey<FormFieldContext> = Symbol('bs-form-field')
</script>

<script setup lang="ts">
/* eslint-disable import/first -- these imports sit below the sibling <script>
   block, which is where the injection key has to live: `<script setup>` cannot
   carry ES module exports. */
import { computed, provide, useId, useSlots } from 'vue'
import HelperText from './HelperText.vue'
import Label from './Label.vue'
import ValidationMessage from './ValidationMessage.vue'

// Port of the FormField export in components/forms/FormField.jsx. The ReactNode
// props (label, help, error) each become a slot with the string prop kept as the
// shorthand the reference always uses.
const props = withDefaults(defineProps<{
    label?: string
    required?: boolean
    optional?: boolean
    /** Helper text below the control. Replaced by the error while one is set. */
    help?: string
    /** Error message: icon + red text. Wires aria-invalid + aria-describedby. */
    error?: string
    /** Id for the control. Generated when omitted. */
    id?: string
}>(), {
    label: undefined,
    required: false,
    optional: false,
    help: undefined,
    error: undefined,
    id: undefined,
})

const slots = useSlots()
const autoId = useId()

const fieldId = computed(() => props.id || autoId)
const hasLabel = computed(() => !!props.label || !!slots.label)
const hasError = computed(() => !!props.error || !!slots.error)
const hasHelp = computed(() => !!props.help || !!slots.help)

const errorId = computed(() => (hasError.value ? `${fieldId.value}-err` : undefined))
// Deviation from the reference: it derives the helper id from `help` alone, so
// while an error is showing, aria-describedby points at a <p> that was never
// rendered. Only the visible message is described here.
const helpId = computed(() => (hasHelp.value && !hasError.value ? `${fieldId.value}-help` : undefined))
const describedBy = computed(() => [errorId.value, helpId.value].filter(Boolean).join(' ') || undefined)

provide(formFieldKey, { id: fieldId, invalid: hasError, describedBy })
</script>

<template>
    <div class="bs-field">
        <Label
            v-if="hasLabel"
            :for="fieldId"
            :required="required"
            :optional="optional"
        >
            <slot name="label">{{ label }}</slot>
        </Label>
        <slot
            :id="fieldId"
            :invalid="hasError"
            :described-by="describedBy"
        />
        <ValidationMessage
            v-if="hasError"
            :id="errorId"
        >
            <slot name="error">
                {{ error }}
            </slot>
        </ValidationMessage>
        <HelperText
            v-else-if="hasHelp"
            :id="helpId"
        >
            <slot name="help">
                {{ help }}
            </slot>
        </HelperText>
    </div>
</template>
