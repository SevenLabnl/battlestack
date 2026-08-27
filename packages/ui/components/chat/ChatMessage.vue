<script setup lang="ts">
import Icon from '../icons/Icon.vue'

// Port of components/chat/ChatMessage.jsx. `role` keeps the spelling from
// ChatMessage.d.ts; `avatar` and `actions` are ReactNode props there, so they become
// named slots. The message body is the default slot and deliberately takes arbitrary
// content: an assistant answer embeds real components — a Table, Badges, a follow-up
// Button — never a screenshot of data (ux-patterns.md, "Chat (AI assistant)").
//
// A user message is a right-aligned tinted bubble with no avatar and no live region:
// the user just typed it, announcing it back is noise. (Notes about the markup live
// here rather than above the root element — a comment before the root makes the
// component multi-root in dev builds and attribute fallthrough silently stops working.)
withDefaults(defineProps<{
    role?: 'user' | 'assistant'
}>(), {
    role: 'assistant',
})
</script>

<template>
    <div
        v-if="role === 'user'"
        class="bs-chatmsg bs-chatmsg--user"
    >
        <div class="bs-chatmsg__bubble">
            <!-- Alignment and tint are the only things marking who spoke, and neither
                 reaches a screen reader. This names the speaker without changing the
                 design. -->
            <span class="bs-visually-hidden">You</span>
            <slot />
        </div>
    </div>

    <div
        v-else
        class="bs-chatmsg"
    >
        <!-- aria-hidden as in the reference: the sparkles chip (or whatever a consumer
             puts in the slot) repeats what the speaker label already says. -->
        <span
            class="bs-chatmsg__avatar"
            aria-hidden="true"
        >
            <slot name="avatar">
                <Icon
                    name="sparkles"
                    :size="15"
                />
            </slot>
        </span>
        <!-- React: style={{minWidth:0,maxWidth:"84%"}} -->
        <div class="bs-chatmsg__body">
            <!-- polite, never assertive: an answer is not an emergency, and assertive
                 would cut off whatever the user is reading or typing. Live regions also
                 announce without moving focus, which is exactly what a thread needs —
                 the caret stays in the composer.
                 aria-atomic stays at its default false so a streamed answer announces
                 the text as it arrives instead of re-reading the whole message.
                 A TypingIndicator placed in this slot brings its own role="status", so
                 the two regions nest and some screen readers repeat the label; the
                 alternative — no region here at all — means real answers are never
                 announced, which is the worse failure. An app that renders the
                 .bs-chatthread container before the first message gets the better
                 version of this for free. -->
            <div
                class="bs-chatmsg__content"
                aria-live="polite"
            >
                <span class="bs-visually-hidden">Assistant</span>
                <slot />
            </div>
            <!-- Copy and thumbs up/down live here. They are icon-only, so whatever goes
                 in needs an accessible name — BsIconButton makes `label` required. -->
            <div
                v-if="$slots.actions"
                class="bs-chatmsg__actions"
            >
                <slot name="actions" />
            </div>
        </div>
    </div>
</template>
