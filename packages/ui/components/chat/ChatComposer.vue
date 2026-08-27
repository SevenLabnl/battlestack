<script setup lang="ts">
import { computed, getCurrentInstance, onMounted, useId, useSlots, useTemplateRef, watch } from 'vue'
import Button from '../actions/Button.vue'
import IconButton from '../actions/IconButton.vue'
import Icon from '../icons/Icon.vue'
import Textarea from '../forms/Textarea.vue'

// Port of components/chat/ChatComposer.jsx. `value` + `onChange` become v-model,
// `onSend` becomes @send, `onAttach` becomes @attach. `hint` is a ReactNode in
// ChatComposer.d.ts, so it is a slot with the string default kept as a prop.
const props = withDefaults(defineProps<{
    placeholder?: string
    disabled?: boolean
    /** Send button shows a spinner; Enter is swallowed until the answer arrives. */
    busy?: boolean
    /** Pass an empty string to drop the hint line, as the reference's falsy check does. */
    hint?: string
}>(), {
    placeholder: 'Ask about your customers, invoices or renewals…',
    disabled: false,
    busy: false,
    hint: 'Enter to send · Shift+Enter for a new line',
})

const emit = defineEmits<{
    send: [value: string]
    attach: []
}>()

const model = defineModel<string>({ default: '' })

const slots = useSlots()
const instance = getCurrentInstance()

const hintId = useId()
const hasHint = computed(() => Boolean(props.hint || slots.hint))

const canSend = computed(() => model.value.trim().length > 0 && !props.disabled && !props.busy)

function send() {
    if (canSend.value) emit('send', model.value.trim())
}

// The one behaviour this group lives or dies on: Enter sends, Shift+Enter inserts a
// newline. Enter is swallowed (preventDefault) even when the message is empty or the
// assistant is busy, exactly as the reference does — otherwise a blocked send would
// silently turn into a stray line break. Shift+Enter is left entirely alone so the
// textarea's own default inserts the newline.
function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    send()
}

const field = useTemplateRef<{ $el: HTMLTextAreaElement }>('field')

// React: el.style.height = Math.min(el.scrollHeight, 130) + "px". The 130 is already
// in the vendored .bs-chatcomposer textarea { max-height: 130px }, so setting the
// content height and letting CSS clamp it keeps the number in one place.
function resize() {
    const el = field.value?.$el
    if (!el) return
    el.style.height = 'auto'
    // scrollHeight is 0 while the composer is not laid out (a hidden tab, a test
    // environment without layout). Collapsing the field to 0px there would be worse
    // than leaving the height alone.
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`
}

onMounted(resize)
// Watching the value rather than the input event also grows the box when the text
// arrives from somewhere else — picking a ChatSuggestion, restoring a draft. The
// reference only resized on typing, so a picked suggestion stayed one line tall and
// clipped. flush: 'post' so the textarea already holds the new text when it is measured.
watch(model, resize, { flush: 'post' })

// React renders the paperclip only when an onAttach callback is passed. The Vue
// equivalent is "only when someone listens for @attach", but a declared emit is
// stripped from $attrs, so the listener is read off the vnode. It is a function and
// not a computed on purpose: vnode.props is not reactive, and a function re-runs on
// every render instead of caching a stale answer.
function hasAttachListener() {
    return Boolean(instance?.vnode.props?.onAttach)
}
</script>

<template>
    <div>
        <div class="bs-chatcomposer">
            <!-- The reference adds style={{alignSelf:"flex-end"}} here and on the send
                 button; .bs-chatcomposer already sets align-items: flex-end, so both are
                 no-ops and do not need a class. `disabled` is passed on, which the
                 reference forgets: a disabled composer that still opens a file picker
                 is a dead end. -->
            <IconButton
                v-if="hasAttachListener()"
                label="Attach file"
                size="sm"
                :disabled="disabled"
                @click="emit('attach')"
            >
                <Icon
                    name="paperclip"
                    :size="16"
                />
            </IconButton>

            <!-- The design has no visible label, so aria-label is the only accessible
                 name — the reference sets one and this keeps it. The hint is wired up as
                 the description on top of that, so "Enter to send · Shift+Enter for a new
                 line" reaches a screen reader user instead of being caption text they
                 never meet. -->
            <Textarea
                ref="field"
                v-model="model"
                :rows="1"
                aria-label="Message"
                :aria-describedby="hasHint ? hintId : undefined"
                :placeholder="placeholder"
                :disabled="disabled"
                @keydown="onKeydown"
            />

            <Button
                size="sm"
                :disabled="disabled || !model.trim()"
                :loading="busy"
                @click="send"
            >
                <template #icon>
                    <Icon
                        name="send"
                        :size="14"
                    />
                </template>
                Send
            </Button>
        </div>

        <p
            v-if="hasHint"
            :id="hintId"
            class="bs-caption bs-chatcomposer__hint"
        >
            <slot name="hint">
                {{ hint }}
            </slot>
        </p>
    </div>
</template>
