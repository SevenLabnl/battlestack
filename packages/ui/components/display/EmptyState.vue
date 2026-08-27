<script setup lang="ts">
import Icon from '../icons/Icon.vue'

// Port of components/display/EmptyState.jsx. `icon` is `string | ReactNode` in
// the reference: the string name stays a prop, the node becomes the #icon slot.
// `title` / `description` keep a string shorthand; `action` is a slot and takes
// exactly one action per the UX patterns ("Empty: EmptyState with one action").
withDefaults(defineProps<{
    /** Glyph name from the icon registry. Use the #icon slot for a custom node. */
    icon?: string
    title?: string
    description?: string
    tone?: 'default' | 'danger'
}>(), {
    icon: 'inbox',
    title: 'Nothing here yet',
    description: undefined,
    tone: 'default',
})
</script>

<template>
    <div class="bs-empty">
        <span
            class="bs-empty__icon"
            :class="{ 'bs-empty__icon--danger': tone === 'danger' }"
        >
            <slot name="icon">
                <Icon
                    :name="icon"
                    :size="22"
                />
            </slot>
        </span>
        <h3 class="bs-h4">
            <slot name="title">
                {{ title }}
            </slot>
        </h3>
        <p
            v-if="description || $slots.description"
            class="bs-small bs-muted bs-empty__desc"
        >
            <slot name="description">
                {{ description }}
            </slot>
        </p>
        <div
            v-if="$slots.action"
            class="bs-empty__actions"
        >
            <slot name="action" />
        </div>
    </div>
</template>
