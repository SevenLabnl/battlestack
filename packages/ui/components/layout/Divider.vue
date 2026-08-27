<script setup lang="ts">
// Port of components/layout/Divider.jsx. Three shapes, one component:
//
//   plain      <hr>, which already carries role="separator" implicitly
//   labelled   a caption between two hairlines, so it needs the role spelled out
//   vertical   a stretched 1px span for toolbars
//
// Only one branch ever renders, so attribute fallthrough still lands on a single
// root. The explanations live here rather than as template comments because a
// comment node inside a v-if branch turns that branch into a fragment and
// fallthrough stops working.
withDefaults(defineProps<{
    orientation?: 'horizontal' | 'vertical'
    /** Centered caption, e.g. "or" */
    label?: string
}>(), {
    orientation: 'horizontal',
    label: undefined,
})
</script>

<template>
    <hr
        v-if="orientation === 'horizontal' && !label"
        class="bs-divider"
    />
    <div
        v-else-if="orientation === 'horizontal'"
        class="bs-divider bs-divider--labelled"
        role="separator"
    >
        <!-- The hairlines are decoration either side of the caption; hiding them
             leaves the separator announcing just its label. -->
        <span
            class="bs-divider__rule"
            aria-hidden="true"
        />
        <span class="bs-caption bs-divider__label">{{ label }}</span>
        <span
            class="bs-divider__rule"
            aria-hidden="true"
        />
    </div>
    <span
        v-else
        class="bs-divider bs-divider--vertical"
        role="separator"
        aria-orientation="vertical"
    />
</template>
