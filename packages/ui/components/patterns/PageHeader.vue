<script setup lang="ts">
// Port of components/patterns/PageHeader.jsx. Every prop in PageHeader.d.ts is a
// ReactNode except nothing — so all of them become slots, with a `string`
// shorthand for `title` and `description`, the two the reference only ever
// passes text into.
//
// `title` stays required exactly as the .d.ts has it: a page without an h1 is
// the one thing this component exists to prevent.
//
// `style` is not a prop: native class and style fall through to the root.
withDefaults(defineProps<{
    /** The page's h1. Use the #title slot for rich content. */
    title: string
    /** One line, under the title. */
    description?: string
}>(), {
    description: undefined,
})
</script>

<template>
    <div class="bs-pagehead">
        <slot name="breadcrumbs" />
        <div class="bs-pagehead__row">
            <div class="bs-pagehead__titles">
                <h1 class="bs-h1">
                    <slot name="title">
                        {{ title }}
                    </slot>
                </h1>
                <p
                    v-if="description || $slots.description"
                    class="bs-pagehead__desc"
                >
                    <slot name="description">
                        {{ description }}
                    </slot>
                </p>
                <div
                    v-if="$slots.meta"
                    class="bs-pagehead__meta"
                >
                    <slot name="meta" />
                </div>
            </div>
            <!-- Max one primary action per the UX patterns; the slot takes the
                 row and the caller decides what is primary. -->
            <div
                v-if="$slots.actions"
                class="bs-pagehead__actions"
            >
                <slot name="actions" />
            </div>
        </div>
        <slot name="tabs" />
    </div>
</template>
