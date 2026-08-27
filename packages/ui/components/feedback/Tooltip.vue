<script setup lang="ts">
import { TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui'

// Port of components/feedback/Tooltip.jsx. `content` keeps its name from
// Tooltip.d.ts, with a #content slot for the ReactNode case; `children` becomes
// the default slot and `style` falls through as a native attribute.
//
// Tooltip labels an icon-only control and nothing else (guidelines/ux-patterns.md).
// Never put information here that the user needs to complete the task — a tooltip
// is unreachable on touch and gone the moment the pointer moves.
//
// The reference is pure CSS: :hover and :focus-within flip the bubble's opacity.
// That is keyboard-visible but it is not a tooltip to assistive tech — nothing
// announces it, and it cannot escape a clipping ancestor. Reka's primitives give
// it a real one: the trigger gets aria-describedby while open, the bubble is
// portalled out of any overflow, and Escape dismisses it. Behaviour only — `as`
// and `as-child` keep our markup and our bs-* classes.
defineOptions({
    // TooltipProvider is renderless, so the default fallthrough would drop `class`
    // and the reference's `style` prop. `.bs-tooltip` is the reference's root
    // element, so they are forwarded there.
    inheritAttrs: false,
})

defineProps<{
    /** Short label for the control. Use the #content slot for rich content. */
    content: string
}>()

// delay-duration 0 matches the reference, which opens on the first hover with
// no wait; Reka's own default is 700ms.
//
// This note sits here, not above the root element: a comment before the root makes
// the component multi-root in dev builds, which silently drops attribute fallthrough.
</script>

<template>
    <TooltipProvider :delay-duration="0">
        <TooltipRoot>
            <span
                class="bs-tooltip"
                v-bind="$attrs"
            >
                <!-- as-child so the caller's own control is the trigger. It keeps its
                     classes and gains the tooltip's aria-describedby, which is what
                     makes this keyboard- and screen-reader-reachable rather than
                     hover-only. -->
                <TooltipTrigger as-child>
                    <slot />
                </TooltipTrigger>
            </span>
            <TooltipPortal>
                <!-- side/side-offset are the vendored `bottom: calc(100% + 6px)`
                     expressed as props, because Reka positions the bubble now. -->
                <TooltipContent
                    class="bs-tooltip__bubble"
                    side="top"
                    :side-offset="6"
                >
                    <slot name="content">
                        {{ content }}
                    </slot>
                </TooltipContent>
            </TooltipPortal>
        </TooltipRoot>
    </TooltipProvider>
</template>
