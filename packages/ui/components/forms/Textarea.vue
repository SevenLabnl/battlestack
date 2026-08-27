<script setup lang="ts">
import { computed, inject, useAttrs } from 'vue'
import { formFieldKey } from './FormField.vue'

// Port of components/forms/Textarea.jsx. `value` + `onChange` become v-model.
//
// inheritAttrs is off only so that the FormField's id and aria-describedby win
// over ones passed by hand: fallthrough attributes are merged last and would
// otherwise override them, leaving the field's <label for> pointing at nothing.
// class and style still land on the <textarea> — it is the root element.
defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
    /** Error styling + aria-invalid. Set for you when the FormField has an error. */
    invalid?: boolean
    rows?: number
}>(), {
    invalid: false,
    rows: 4,
})

const model = defineModel<string>()

const attrs = useAttrs()
const field = inject(formFieldKey, null)

const invalid = computed(() => props.invalid || !!field?.invalid.value)
const fieldId = computed(() => (field ? field.id.value : attrs.id as string | undefined))
const describedBy = computed(() => (field ? field.describedBy.value : attrs['aria-describedby'] as string | undefined))

function onInput(event: Event) {
    model.value = (event.target as HTMLTextAreaElement).value
}
</script>

<template>
    <textarea
        v-bind="$attrs"
        :id="fieldId"
        class="bs-input bs-textarea"
        :rows="rows"
        :value="model"
        :aria-invalid="invalid || undefined"
        :aria-describedby="describedBy"
        @input="onInput"
    />
</template>
