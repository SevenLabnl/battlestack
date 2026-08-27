<script setup lang="ts">
import { computed, useSlots } from 'vue'
import Button from '../actions/Button.vue'
import Dialog from '../feedback/Dialog.vue'

// Port of components/patterns/ConfirmDialog.jsx. Prop names, the tone values and
// every default come literally from ConfirmDialog.d.ts. `onClose` / `onConfirm`
// become the `close` and `confirm` emits.
//
// It is a thin composition on purpose: Dialog already owns the overlay, the focus
// trap, focus restoration, Escape and the backdrop, so none of that is rebuilt
// here. What this adds is the shape of a decision — one sentence of consequence
// and two buttons, cancel left of a verb-labelled confirm.
//
// Per the destructive-action rules the caller names the object and the count in
// `title` ("Delete 3 customers?"), states the consequence in `description`, and
// labels the confirm with the verb ("Delete customers", never "OK"). `tone`
// defaults to danger because that is what a confirmation is nearly always for.
//
// The description goes into Dialog's #description slot rather than its body, so
// it becomes the dialog's aria-describedby target: the consequence line is read
// out with the title when focus lands, which is the whole point of having one.
const props = withDefaults(defineProps<{
    open?: boolean
    title?: string
    /** The consequence line. Say what happens and whether it can be undone. */
    description?: string
    /** Verb + object, e.g. "Delete customers". */
    confirmLabel?: string
    cancelLabel?: string
    tone?: 'danger' | 'primary'
    /** Confirm shows a spinner and cancel is blocked while the action runs. */
    loading?: boolean
}>(), {
    open: false,
    title: 'Are you sure?',
    description: undefined,
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    tone: 'danger',
    loading: false,
})

const emit = defineEmits<{
    close: []
    confirm: []
}>()

const slots = useSlots()

const hasDescription = computed(() => Boolean(props.description || slots.default))
</script>

<template>
    <Dialog
        :open="open"
        :title="title"
        size="sm"
        @close="emit('close')"
    >
        <template
            v-if="hasDescription"
            #description
        >
            <slot>{{ description }}</slot>
        </template>
        <template #footer>
            <Button
                variant="secondary"
                :disabled="loading"
                @click="emit('close')"
            >
                {{ cancelLabel }}
            </Button>
            <Button
                :variant="tone === 'danger' ? 'danger' : 'primary'"
                :loading="loading"
                @click="emit('confirm')"
            >
                {{ confirmLabel }}
            </Button>
        </template>
    </Dialog>
</template>
