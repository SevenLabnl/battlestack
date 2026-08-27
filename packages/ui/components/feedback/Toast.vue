<script setup lang="ts">
import { computed, getCurrentInstance, useSlots } from 'vue'
import IconButton from '../actions/IconButton.vue'
import Icon from '../icons/Icon.vue'

// Port of components/feedback/Toast.jsx. Tone names are literally those of
// Toast.d.ts; `title`, `description` and `action` are ReactNode props in the
// reference and become slots here, with `string` shorthands for title and
// description because that is all the reference ever passes.
//
// Deliberately plain Vue and not a Reka primitive: Toast.d.ts declares it usable
// on its own, and Reka's ToastRoot throws without a ToastProvider above it. The
// live region, the timer and the stacking live in ToastStack, which wraps this
// component in Reka's ToastRoot through `as-child` — so the class here is the
// class that ends up in the DOM either way.
//
// A toast confirms something that already happened. Anything the user must act
// on belongs in an Alert (guidelines/ux-patterns.md, "Feedback").
//
// Status is never colour alone: the tone picks a glyph as well as a colour, and
// the title says the same thing in words.
const ICONS = {
    info: 'info',
    success: 'check-circle',
    warning: 'alert-triangle',
    danger: 'alert-circle',
} as const

const props = withDefaults(defineProps<{
    tone?: 'info' | 'success' | 'warning' | 'danger'
    /** Required: one line. Use the #title slot for rich content. */
    title: string
    description?: string
}>(), {
    tone: 'info',
    description: undefined,
})

const emit = defineEmits<{
    dismiss: []
}>()

const slots = useSlots()
const instance = getCurrentInstance()

const hasDescription = computed(() => Boolean(props.description || slots.description))

// React renders the dismiss button only when an onDismiss callback is passed.
// The Vue equivalent is "only when someone listens for @dismiss", but a declared
// emit is stripped from $attrs, so the listener is read off the vnode. A function
// and not a computed on purpose: vnode.props is not reactive.
function hasDismissListener() {
    return Boolean(instance?.vnode.props?.onDismiss)
}
</script>

<template>
    <div
        class="bs-toast"
        role="status"
    >
        <!-- role="status" above is a polite live region: it announces the
             confirmation without moving focus, which is the whole point of a
             toast. Inside ToastStack, Reka owns the announcement and clears the
             attribute so the same text is not read twice. The comment lives
             inside the root, not above it: a comment at the top level would make
             this a fragment and silently kill attribute fallthrough. -->
        <Icon
            :name="ICONS[tone]"
            :size="17"
            :class="['bs-toast__icon', `bs-toast__icon--${tone}`]"
        />
        <div class="bs-toast__content">
            <div class="bs-toast__title">
                <slot name="title">
                    {{ title }}
                </slot>
            </div>
            <div
                v-if="hasDescription"
                class="bs-small bs-muted bs-toast__desc"
            >
                <slot name="description">
                    {{ description }}
                </slot>
            </div>
            <div
                v-if="$slots.action"
                class="bs-toast__action"
            >
                <slot name="action" />
            </div>
        </div>
        <IconButton
            v-if="hasDismissListener()"
            label="Dismiss"
            size="sm"
            class="bs-toast__dismiss"
            @click="emit('dismiss')"
        >
            <Icon
                name="x"
                :size="15"
            />
        </IconButton>
    </div>
</template>
