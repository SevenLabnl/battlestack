<script setup lang="ts">
import { computed, useSlots } from 'vue'

// Port of components/display/Card.jsx. `title`, `subtitle`, `actions` and
// `footer` are ReactNode props in the reference; here they are named slots, with
// a `string` shorthand for title/subtitle because the reference only ever passes
// text into those two.
const props = withDefaults(defineProps<{
    title?: string
    subtitle?: string
    /** Skip the padded body wrapper — for edge-to-edge content like a table. */
    flush?: boolean
}>(), {
    title: undefined,
    subtitle: undefined,
    flush: false,
})

const slots = useSlots()

const hasTitle = computed(() => Boolean(props.title || slots.title))
const hasSubtitle = computed(() => Boolean(props.subtitle || slots.subtitle))
// The reference gates the header on `(title || actions)`, which silently drops a
// card that only has a subtitle. Subtitle is part of the test here so no prop can
// go missing.
const hasHeader = computed(() => hasTitle.value || hasSubtitle.value || Boolean(slots.actions))
</script>

<template>
    <div class="bs-card">
        <div
            v-if="hasHeader"
            class="bs-card__header"
        >
            <div class="bs-card__titles">
                <h3
                    v-if="hasTitle"
                    class="bs-h4"
                >
                    <slot name="title">
                        {{ title }}
                    </slot>
                </h3>
                <p
                    v-if="hasSubtitle"
                    class="bs-caption"
                >
                    <slot name="subtitle">
                        {{ subtitle }}
                    </slot>
                </p>
            </div>
            <div
                v-if="$slots.actions"
                class="bs-card__actions"
            >
                <slot name="actions" />
            </div>
        </div>

        <slot v-if="flush" />
        <div
            v-else
            class="bs-card__body"
        >
            <slot />
        </div>

        <div
            v-if="$slots.footer"
            class="bs-card__footer"
        >
            <slot name="footer" />
        </div>
    </div>
</template>
