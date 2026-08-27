<script setup lang="ts">
// Port of the Label export in components/forms/FormField.jsx.
// `htmlFor` is React's spelling of the native `for` attribute; in Vue it falls
// through as a plain attribute, so it is not a prop here.
withDefaults(defineProps<{
    /** Marks the field required: a red asterisk plus "(required)" for screen readers. */
    required?: boolean
    /** Marks the field optional in words. Never use both. */
    optional?: boolean
}>(), {
    required: false,
    optional: false,
})
</script>

<template>
    <label class="bs-label">
        <slot />
        <span
            v-if="required"
            class="bs-req"
            aria-hidden="true"
        >*</span>
        <span
            v-if="required"
            class="bs-visually-hidden"
        >(required)</span>
        <span
            v-if="optional"
            class="bs-optional"
        >Optional</span>
    </label>
</template>
