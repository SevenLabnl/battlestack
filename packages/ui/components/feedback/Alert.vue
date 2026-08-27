<script setup lang="ts">
import { computed, getCurrentInstance, useSlots } from 'vue'
import IconButton from '../actions/IconButton.vue'
import Icon from '../icons/Icon.vue'

// Port of components/feedback/Alert.jsx. Tone names are literally those of
// Alert.d.ts. React's `title`, `action` and `children` ReactNode props become
// slots, with a `string` shorthand for `title` because the reference only ever
// passes text there.
//
// Alert, not Toast, is the component for something the user has to act on:
// guidelines/ux-patterns.md puts persistent page state here and keeps the toast
// for after-the-fact confirmations.
//
// Status is never colour alone. Each tone brings its own glyph on top of its
// tint, so the meaning survives greyscale, colour blindness and a high-contrast
// theme; the sentence in the body carries it a third time.
const ICONS = {
    info: 'info',
    success: 'check-circle',
    warning: 'alert-triangle',
    danger: 'alert-circle',
} as const

const props = withDefaults(defineProps<{
    tone?: 'info' | 'success' | 'warning' | 'danger'
    title?: string
}>(), {
    tone: 'info',
    title: undefined,
})

const emit = defineEmits<{
    dismiss: []
}>()

const slots = useSlots()
const instance = getCurrentInstance()

const hasTitle = computed(() => Boolean(props.title || slots.title))

// danger and warning interrupt: they get role="alert" (assertive), everything
// else role="status" (polite). Straight from the reference, and from the
// prompt's "danger/warning use role=alert".
const role = computed(() => (props.tone === 'danger' || props.tone === 'warning' ? 'alert' : 'status'))

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
        :class="['bs-alert', `bs-alert--${tone}`]"
        :role="role"
    >
        <Icon
            :name="ICONS[tone]"
            :size="17"
        />
        <div class="bs-alert__content">
            <div
                v-if="hasTitle"
                class="bs-alert__title"
            >
                <slot name="title">
                    {{ title }}
                </slot>
            </div>
            <div
                v-if="$slots.default"
                class="bs-alert__body"
            >
                <slot />
            </div>
            <div
                v-if="$slots.action"
                class="bs-alert__action"
            >
                <slot name="action" />
            </div>
        </div>
        <IconButton
            v-if="hasDismissListener()"
            label="Dismiss"
            size="sm"
            class="bs-alert__dismiss"
            @click="emit('dismiss')"
        >
            <Icon
                name="x"
                :size="15"
            />
        </IconButton>
    </div>
</template>
