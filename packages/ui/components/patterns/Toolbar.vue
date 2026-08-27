<script setup lang="ts">
import { computed, getCurrentInstance } from 'vue'
import Input from '../forms/Input.vue'
import Icon from '../icons/Icon.vue'

// Port of components/patterns/Toolbar.jsx (the Toolbar half; FilterChip is its
// own SFC, as every export in this package is one file).
//
// `search` in Toolbar.d.ts is `{value, onChange, placeholder}` — a value plus a
// change callback, which the React→Vue mapping turns into `v-model`. The object
// keeps its name and its `placeholder` (and `onChange`, kept as a fallback the
// way column `render` is), while the text itself rides on `v-model`:
//
//     <BsToolbar v-model="q" :search="{ placeholder: 'Search customers…' }">
//
// `children` and `actions` are ReactNode props and become the default and
// #actions slots. `style` falls through.
const props = withDefaults(defineProps<{
    /** Presence renders the search field. `value` / `onChange` are the pre-v-model fallback. */
    search?: { value?: string, onChange?: (v: string) => void, placeholder?: string }
}>(), {
    search: undefined,
})

const model = defineModel<string>()

const instance = getCurrentInstance()

// The reference's two fallbacks, kept apart on purpose: the placeholder is an
// example ("Search customers…"), the accessible name is a label ("Search").
const placeholder = computed(() => props.search?.placeholder || 'Search…')
const label = computed(() => props.search?.placeholder || 'Search')

// v-model wins; `search.value` is what a caller porting straight off the
// reference passes. Neither is required — the field works uncontrolled too.
const value = computed(() => model.value ?? props.search?.value ?? '')

// The field renders when the caller opted into search at all: either by passing
// the `search` object or by binding v-model. A declared model listener is
// stripped from $attrs, so it is read off the vnode — a function and not a
// computed because vnode.props is not reactive.
function hasSearch() {
    return props.search !== undefined || Boolean(instance?.vnode.props?.['onUpdate:modelValue'])
}

function onUpdate(next: string | number | undefined) {
    const text = String(next ?? '')
    model.value = text
    props.search?.onChange?.(text)
}

// role="search" is the reference's, but it is on the row unconditionally there —
// a landmark promising a search field to anyone who jumps to it, on a toolbar
// that may hold nothing but filter chips. Here it is tied to the field actually
// being rendered, which is what the role claims.
</script>

<template>
    <div
        class="bs-toolbar"
        :role="hasSearch() ? 'search' : undefined"
    >
        <div
            v-if="hasSearch()"
            class="bs-toolbar__search"
        >
            <Input
                size="sm"
                :placeholder="placeholder"
                :aria-label="label"
                :model-value="value"
                @update:model-value="onUpdate"
            >
                <template #leadingIcon>
                    <Icon
                        name="search"
                        :size="15"
                    />
                </template>
            </Input>
        </div>
        <slot />
        <div class="bs-toolbar__spacer" />
        <slot name="actions" />
    </div>
</template>
