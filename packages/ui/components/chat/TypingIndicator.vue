<script setup lang="ts">
// Port of the TypingIndicator export in components/chat/ChatMessage.jsx. One file per
// component, so it lives here rather than beside ChatMessage.
//
// The dots are decoration; role="status" plus the label is the whole accessible
// content. status is implicitly aria-live="polite" and aria-atomic="true", which is
// right for a one-line "still working" message: it waits its turn and reads whole.
withDefaults(defineProps<{
    /** Announced while the answer is being generated. */
    label?: string
}>(), {
    label: 'Assistant is thinking',
})
</script>

<template>
    <span
        class="bs-typing"
        role="status"
        :aria-label="label"
    >
        <i />
        <i />
        <i />
    </span>
</template>
