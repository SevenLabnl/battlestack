<script setup lang="ts">
import { computed, useId, useSlots } from 'vue'

// Port of components/layout/Section.jsx.
// `title`, `description` and `actions` are ReactNode in the reference, so each
// becomes a slot; title and description keep a string prop shorthand because
// that is all the reference ever passes them.
const props = withDefaults(defineProps<{
    title?: string
    description?: string
}>(), {
    title: undefined,
    description: undefined,
})

const slots = useSlots()

// A bare <section> is a generic container; it only maps to the region landmark
// once it has an accessible name, so the heading is wired up as that name. The
// id has to be unique per instance and SSR-stable, hence useId().
const headingId = useId()

const hasTitle = computed(() => Boolean(props.title || slots.title))
const hasDescription = computed(() => Boolean(props.description || slots.description))
const hasActions = computed(() => Boolean(slots.actions))

// The reference gated the header on `title || actions`, which silently dropped a
// description passed on its own. Included here so no prop renders as nothing.
const hasHeader = computed(() => hasTitle.value || hasDescription.value || hasActions.value)
</script>

<template>
    <section
        class="bs-section"
        :aria-labelledby="hasTitle ? headingId : undefined"
    >
        <header
            v-if="hasHeader"
            class="bs-section__header"
        >
            <div class="bs-section__heading">
                <h2
                    v-if="hasTitle"
                    :id="headingId"
                    class="bs-h3"
                >
                    <slot name="title">
                        {{ title }}
                    </slot>
                </h2>
                <p
                    v-if="hasDescription"
                    class="bs-small bs-muted"
                >
                    <slot name="description">
                        {{ description }}
                    </slot>
                </p>
            </div>
            <div
                v-if="hasActions"
                class="bs-section__actions"
            >
                <slot name="actions" />
            </div>
        </header>
        <slot />
    </section>
</template>
