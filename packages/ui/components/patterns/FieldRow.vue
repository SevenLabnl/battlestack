<script setup lang="ts">
// Port of the FieldRow half of components/patterns/FormSection.jsx. Two related
// fields side by side inside a FormSection, one per column, stacking under 820px.
// It has no props at all: `children` is the default slot and `style` falls
// through to the root, which is the whole of FieldRow's contract.
</script>

<template>
    <div class="bs-fieldrow">
        <slot />
    </div>
</template>
