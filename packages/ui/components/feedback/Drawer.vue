<script setup lang="ts">
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, getCurrentInstance, useSlots } from 'vue'
import IconButton from '../actions/IconButton.vue'
import Icon from '../icons/Icon.vue'

// Port of components/feedback/Drawer.jsx. Prop names and the `side` values are
// literally those of Drawer.d.ts; `footer` and `title` are ReactNode props in the
// reference and become slots here, with a `string` shorthand for the title.
//
// Same semantics as Dialog, same primitives: a Drawer is a modal dialog that
// happens to be pinned to an edge, so it is built on Reka's Dialog rather than on
// a second set of primitives. That buys the three gaps the export admits to —
// a real focus trap, focus restored to whatever opened it, and background content
// marked aria-hidden — on top of the Escape and backdrop close the reference had.
//
// Reka supplies behaviour only: every primitive renders our element and our bs-*
// class through `as` / `as-child`.
defineOptions({
    // DialogRoot is a renderless provider, so the default fallthrough would drop
    // `class` and every native attribute on the floor. They belong on the panel,
    // which is what `.bs-drawer` is, so they are forwarded to DialogContent.
    inheritAttrs: false,
})

const props = withDefaults(defineProps<{
    open?: boolean
    /** Required: the drawer's accessible name. Use the #title slot for rich content. */
    title: string
    side?: 'right' | 'left'
}>(), {
    open: false,
    side: 'right',
})

const emit = defineEmits<{
    close: []
}>()

const slots = useSlots()
const instance = getCurrentInstance()

// right is the base class, left the modifier — as in the reference.
const classes = computed(() => [
    'bs-drawer',
    props.side === 'left' ? 'bs-drawer--left' : '',
].filter(Boolean))

// Reka points aria-describedby at DialogDescription's id unconditionally. With no
// description rendered that id names nothing, and a dangling reference is worse
// for a screen reader than no reference at all — so the attribute is cleared
// unless the slot is filled. An empty object leaves Reka's own value in place.
const describedBy = computed(() => (slots.description ? {} : { 'aria-describedby': undefined }))

// React renders the close button only when an onClose callback is passed, and a
// drawer without one cannot be dismissed at all. The Vue equivalent is "only when
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
        <!-- Portalled to the body so a drawer opened from a row inside a scrolling
             table is still pinned to the viewport edge, not to the scroller. -->
        <DialogPortal>
            <!-- `.bs-drawerwrap` is the backdrop; the panel is its child in the
                 reference. Reka renders overlay and content as siblings by default,
                 but DialogOverlay takes a slot, so the nesting is preserved. -->
            <DialogOverlay class="bs-drawerwrap">
                <!-- aria-modal is the reference's, not Reka's: Reka relies on
                     aria-hidden'ing everything else, which is the stronger of the
                     two but leaves the panel undeclared. Both is what the platform
                     expects of a modal dialog. -->
                <DialogContent
                    :class="classes"
                    aria-modal="true"
                    v-bind="{ ...describedBy, ...$attrs }"
                >
                    <div class="bs-drawer__header">
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
                            @click="emit('close')"
                        >
                            <Icon
                                name="x"
                                :size="16"
                            />
                        </IconButton>
                    </div>
                    <!-- Only the body scrolls; header and footer stay pinned
                         (`.bs-drawer__body` is flex: 1 with overflow-y: auto). -->
                    <div class="bs-drawer__body">
                        <DialogDescription
                            v-if="$slots.description"
                            as="p"
                            class="bs-drawer__desc"
                        >
                            <slot name="description" />
                        </DialogDescription>
                        <slot />
                    </div>
                    <!-- Primary action bottom-right: `.bs-drawer__footer` is
                         justify-content: flex-end, so slot order is Cancel then verb. -->
                    <div
                        v-if="$slots.footer"
                        class="bs-drawer__footer"
                    >
                        <slot name="footer" />
                    </div>
                </DialogContent>
            </DialogOverlay>
        </DialogPortal>
    </DialogRoot>
</template>
