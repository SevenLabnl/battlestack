<script setup lang="ts">
// Port of components/patterns/FormSection.jsx (the FormSection half; FieldRow is
// its own SFC). A two-column band: title and description left, the stacked fields
// right, collapsing to one column under 820px — all of it in the vendored
// `.bs-formsection` grid, so this port is markup only.
//
// `title` and `description` are ReactNodes in FormSection.d.ts and keep a string
// shorthand next to their slot; `children` is the default slot; `style` falls
// through. `title` stays required, as the .d.ts has it.
//
// The h2 is deliberate: the band sits under the page's h1, so the section
// headings are the second level of the document outline.
withDefaults(defineProps<{
    title: string
    description?: string
}>(), {
    description: undefined,
})
</script>

<template>
    <div class="bs-formsection">
        <div>
            <h2 class="bs-formsection__title">
                <slot name="title">
                    {{ title }}
                </slot>
            </h2>
            <p
                v-if="description || $slots.description"
                class="bs-formsection__desc"
            >
                <slot name="description">
                    {{ description }}
                </slot>
            </p>
        </div>
        <div class="bs-formsection__fields">
            <slot />
        </div>
    </div>
</template>
