<script setup lang="ts">
import Icon from '../icons/Icon.vue'

// Port of the FilterChip half of components/patterns/Toolbar.jsx. Prop names come
// literally from FilterChipProps; `label` is a ReactNode there and keeps a string
// shorthand plus the default slot. `onClick` / `onClear` become the `click` and
// `clear` emits.
//
// The chip is a toggle: `aria-pressed` is what tells assistive tech that a filter
// is active, so the state is never carried by the tint alone.
//
// The reference hangs the clear handler on the × <svg> and gives it
// label="clear filter", which makes it an announced image nested inside a button
// — not focusable, not reachable by keyboard, and a second name competing with
// the chip's own. Here the × is decorative and pointer-only: it emits `clear`
// with the click stopped, while keyboard users press the chip itself, which emits
// `click` — the toggle every caller in the export wires to the same state.
withDefaults(defineProps<{
    label?: string
    /** Filter is active: solid tinted chip instead of the dashed outline. */
    on?: boolean
}>(), {
    label: undefined,
    on: false,
})

const emit = defineEmits<{
    click: []
    clear: []
}>()

function onClear(event: MouseEvent) {
    event.stopPropagation()
    emit('clear')
}
</script>

<template>
    <button
        type="button"
        class="bs-toolbar__chip"
        :data-on="on || undefined"
        :aria-pressed="on"
        @click="emit('click')"
    >
        <Icon
            v-if="!on"
            name="plus"
            :size="13"
        />
        <slot>{{ label }}</slot>
        <Icon
            v-if="on"
            name="x"
            class="bs-toolbar__chip-clear"
            :size="13"
            @click="onClear"
        />
    </button>
</template>
