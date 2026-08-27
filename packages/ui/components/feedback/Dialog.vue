<script setup lang="ts">
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, getCurrentInstance, useSlots } from 'vue'
import IconButton from '../actions/IconButton.vue'
import Icon from '../icons/Icon.vue'

// Port of components/feedback/Dialog.jsx. Prop names and sizes are literally
// those of Dialog.d.ts; `footer` and `title` are ReactNode props in the
// reference and become slots here, with a `string` shorthand for the title.
//
// The reference hand-rolls Escape and backdrop close and focuses the panel, but
// the export's own readme admits it has no focus trap. This port is built on
// Reka's Dialog primitives instead, which add the three things production needs:
// focus is trapped inside the panel and loops at both edges, focus returns to
// whatever opened the dialog when it closes, and everything behind it is marked
// aria-hidden while it is open. Escape, backdrop click and the modal semantics
// come along with them.
//
// Reka supplies behaviour only: every primitive here renders our element and our
// bs-* class through `as` / `as-child`.
defineOptions({
    // DialogRoot is a renderless provider, so the default fallthrough would drop
    // `class` and every native attribute on the floor. They belong on the panel,
    // which is what `.bs-dialog` is, so they are forwarded to DialogContent.
    inheritAttrs: false,
})

const props = withDefaults(defineProps<{
    open?: boolean
    /** Required: the dialog's accessible name. Use the #title slot for rich content. */
    title: string
    size?: 'sm' | 'md' | 'lg'
}>(), {
    open: false,
    size: 'md',
})

const emit = defineEmits<{
    close: []
}>()

const slots = useSlots()
const instance = getCurrentInstance()

// `size !== 'md'` mirrors the reference: md is the base class, not a modifier.
const classes = computed(() => [
    'bs-dialog',
    props.size !== 'md' ? `bs-dialog--${props.size}` : '',
].filter(Boolean))

// Reka points aria-describedby at DialogDescription's id unconditionally. With no
// description rendered that id names nothing, and a dangling reference is worse
// for a screen reader than no reference at all — so the attribute is cleared
// unless the slot is filled. An empty object leaves Reka's own value in place.
const describedBy = computed(() => (slots.description ? {} : { 'aria-describedby': undefined }))

// React renders the close button only when an onClose callback is passed, and a
// dialog without one cannot be dismissed at all. The Vue equivalent is "only when
// someone listens for @close", but a declared emit is stripped from $attrs, so the
// listener is read off the vnode. A function and not a computed on purpose:
// vnode.props is not reactive.
function hasCloseListener() {
    return Boolean(instance?.vnode.props?.onClose)
}

// Escape, backdrop click and the close button all land here. `open` stays a prop:
// the parent owns it exactly as it does in the reference.
function onOpenChange(value: boolean) {
    if (!value) emit('close')
}
</script>

<template>
    <DialogRoot
        :open="open"
        @update:open="onOpenChange"
    >
        <!-- Portalled to the body so a dialog opened from inside a scroll
             container or a transformed ancestor is still centred on the viewport. -->
        <DialogPortal>
            <!-- The reference nests the panel inside the backdrop and lets
                 `.bs-backdrop`'s grid centre it. Reka renders overlay and content as
                 siblings by default; DialogOverlay takes a slot, so the reference's
                 nesting — and with it the centring — is kept. -->
            <DialogOverlay class="bs-backdrop">
                <!-- aria-modal is the reference's, not Reka's: Reka relies on
                     aria-hidden'ing everything else, which is the stronger of the
                     two but leaves the panel undeclared. Both is what the platform
                     expects of a modal dialog. -->
                <DialogContent
                    :class="classes"
                    aria-modal="true"
                    v-bind="{ ...describedBy, ...$attrs }"
                >
                    <div class="bs-dialog__header">
                        <DialogTitle
                            as="h2"
                            class="bs-h3"
                        >
                            <slot name="title">
                                {{ title }}
                            </slot>
                        </DialogTitle>
                        <IconButton
                            v-if="hasCloseListener()"
                            label="Close"
                            size="sm"
                            class="bs-dialog__close"
                            @click="emit('close')"
                        >
                            <Icon
                                name="x"
                                :size="16"
                            />
                        </IconButton>
                    </div>
                    <div class="bs-dialog__body">
                        <DialogDescription
                            v-if="$slots.description"
                            as="p"
                            class="bs-dialog__desc"
                        >
                            <slot name="description" />
                        </DialogDescription>
                        <slot />
                    </div>
                    <!-- Primary action bottom-right: `.bs-dialog__footer` is
                         justify-content: flex-end, so slot order is Cancel then verb. -->
                    <div
                        v-if="$slots.footer"
                        class="bs-dialog__footer"
                    >
                        <slot name="footer" />
                    </div>
                </DialogContent>
            </DialogOverlay>
        </DialogPortal>
    </DialogRoot>
</template>
