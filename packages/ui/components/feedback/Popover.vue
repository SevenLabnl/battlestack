<script setup lang="ts">
import { PopoverAnchor, PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed, useSlots } from 'vue'

// Port of components/feedback/Popover.jsx. Prop names and the `align` values are
// literally those of Popover.d.ts. React's `trigger` element prop becomes the
// #trigger slot and `title` becomes a slot with a `string` shorthand, since the
// reference only ever passes text there.
//
// Built on Reka's Popover primitives: they own the open state, the outside-click
// and Escape dismissal the reference hand-rolled, and — unlike the reference —
// they wire aria-expanded / aria-haspopup / aria-controls to the trigger, return
// focus to it on close, and reposition the panel when it would collide with the
// viewport edge. Reka supplies behaviour only; `as` / `as-child` keep our markup
// and our bs-* classes.
//
// Non-modal on purpose: a popover is a light picker (guidelines/ux-patterns.md),
// so the page behind it stays interactive. Anything that needs a decision is a
// Dialog.
defineOptions({
    // PopoverRoot is a renderless provider, so the default fallthrough would drop
    // `class` and every native attribute. `.bs-anchor` is the reference's root
    // element, so they are forwarded there.
    inheritAttrs: false,
})

const props = withDefaults(defineProps<{
    align?: 'left' | 'right'
    title?: string
}>(), {
    align: 'left',
    title: undefined,
})

const slots = useSlots()

const hasTitle = computed(() => Boolean(props.title || slots.title))

// left is the base class, right the modifier — as in the reference. The class is
// kept for parity, but the alignment itself is Reka's: see the note in
// styles/extra/feedback.css about why the vendored offsets cannot do the work
// once the panel is portalled.
const classes = computed(() => [
    'bs-popover',
    props.align === 'right' ? 'bs-popover--right' : '',
].filter(Boolean))

const alignment = computed(() => (props.align === 'right' ? 'end' : 'start'))
</script>

<template>
    <PopoverRoot>
        <PopoverAnchor
            as="span"
            class="bs-anchor"
            v-bind="$attrs"
        >
            <!-- as-child so the caller's own button is the trigger: it keeps its
                 classes and gains aria-expanded / aria-haspopup="dialog". -->
            <PopoverTrigger as-child>
                <slot name="trigger" />
            </PopoverTrigger>
        </PopoverAnchor>
        <!-- Portalled so a popover opened from inside a scroll container or a
             transformed ancestor is not clipped by it. -->
        <PopoverPortal>
            <!-- side-offset 6 is the `calc(100% + 6px)` the vendored .bs-popover
                 uses; it moves from CSS to a prop because Reka positions the panel. -->
            <PopoverContent
                :class="classes"
                side="bottom"
                :align="alignment"
                :side-offset="6"
            >
                <h3
                    v-if="hasTitle"
                    class="bs-h4 bs-popover__title"
                >
                    <slot name="title">
                        {{ title }}
                    </slot>
                </h3>
                <slot />
            </PopoverContent>
        </PopoverPortal>
    </PopoverRoot>
</template>
