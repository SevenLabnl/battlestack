<script setup lang="ts">
import { ToastProvider, ToastRoot, ToastViewport } from 'reka-ui'
import { BS_TOAST_DURATION, useBsToast } from '../../composables/useBsToast'
import Toast from './Toast.vue'

// Port of components/feedback/Toast.jsx's ToastStack, plus the queue the export
// leaves to the app. Mount it once, near the root of the layout: it renders every
// toast pushed through `useBsToast().add(...)`, bottom-right, newest at the
// bottom, capped at three (guidelines/ux-patterns.md, "Feedback").
//
// The `children` of the .d.ts survive as the default slot, so the reference's
// dumb usage — `<BsToastStack><BsToast … /></BsToastStack>` — still renders. Those
// children are static: the parent that put them there owns their lifetime.
//
// Reka's Toast primitives supply the parts the reference had no answer for: a
// region landmark reachable with F8, an aria-live announcement that never moves
// focus, a ~5s timer that pauses while the pointer or focus is over the stack,
// and reversed tab order so the newest toast is reached first. `as` / `as-child`
// keep our markup and our bs-* classes.
defineOptions({
    // ToastProvider is a renderless provider, so the default fallthrough would
    // drop `class` and every native attribute. `.bs-toaststack` is the reference's
    // root element, so they are forwarded to the viewport.
    inheritAttrs: false,
})

const { toasts, dismiss } = useBsToast()

// Reka's timer fires `update:open`; the queue is the source of truth, so the
// close is turned straight back into a removal.
function onOpenChange(id: number, open: boolean) {
    if (!open) dismiss(id)
}
</script>

<template>
    <ToastProvider :duration="BS_TOAST_DURATION">
        <ToastViewport
            as="div"
            class="bs-toaststack"
            v-bind="$attrs"
        >
            <slot />
        </ToastViewport>
        <!-- ToastRoot teleports itself into the viewport above, so declaring it
             as a sibling is what puts `.bs-toast` directly inside `.bs-toaststack`.
             type="background" keeps the announcement polite: a confirmation should
             wait its turn rather than interrupt what is being read. -->
        <ToastRoot
            v-for="item in toasts"
            :key="item.id"
            as-child
            type="background"
            :open="true"
            :duration="item.duration ?? BS_TOAST_DURATION"
            :role="undefined"
            @update:open="(open: boolean) => onOpenChange(item.id, open)"
        >
            <!-- :role="undefined" above clears the Toast's own role="status".
                 Reka already announces this toast through its own live region, and
                 leaving both in place makes a screen reader read it twice. -->
            <Toast
                :tone="item.tone"
                :title="item.title"
                :description="item.description"
                @dismiss="dismiss(item.id)"
            />
        </ToastRoot>
    </ToastProvider>
</template>
