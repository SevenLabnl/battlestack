<script setup lang="ts">
import Icon from '../icons/Icon.vue'

// Port of the ValidationMessage export in components/forms/FormField.jsx.
// The icon carries the same meaning as the colour, so the error never depends on
// colour alone. `id` is declared for the same reason as in HelperText.
withDefaults(defineProps<{
    id?: string
}>(), {
    id: undefined,
})
</script>

<template>
    <p
        :id="id"
        class="bs-errmsg"
    >
        <Icon
            name="alert-circle"
            :size="14"
        />
        <span><slot /></span>
    </p>
</template>
