<script setup lang="ts">
// Port of the HelperText export in components/forms/FormField.jsx.
// `id` is declared rather than left to fall through because FormField passes it
// deliberately: it is the target of the control's aria-describedby.
withDefaults(defineProps<{
    id?: string
}>(), {
    id: undefined,
})
</script>

<template>
    <p
        :id="id"
        class="bs-help"
    >
        <slot />
    </p>
</template>
