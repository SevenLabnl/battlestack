<script setup lang="ts">
import Button from '../actions/Button.vue'

// Port of the ChatSuggestions export in components/chat/ChatComposer.jsx. `items`
// stays a prop — it comes straight from ChatSuggestionsProps — and `onPick` becomes
// @pick. Starter suggestions belong on the empty thread (ux-patterns.md); showing or
// hiding them is the thread's job, so this renders whatever it is given.
//
// The row is React's style={{display:"flex",gap:"8px",flexWrap:"wrap"}} on a bare div.
// role="group" plus a name is the only thing telling a screen reader why these buttons
// sit together; without it they are three unrelated sentences. (Notes live here rather
// than above the root element: a comment before the root makes the component
// multi-root in dev builds, and attribute fallthrough silently stops working.)
withDefaults(defineProps<{
    /** ChatSuggestionsProps types this as required, but the reference defaults it to
     *  an empty array — an empty thread that has nothing to suggest renders nothing
     *  rather than warning. */
    items?: string[]
}>(), {
    items: () => [],
})

defineEmits<{
    pick: [item: string]
}>()
</script>

<template>
    <div
        class="bs-chatsuggestions"
        role="group"
        aria-label="Starter suggestions"
    >
        <Button
            v-for="item in items"
            :key="item"
            variant="secondary"
            size="sm"
            @click="$emit('pick', item)"
        >
            {{ item }}
        </Button>
    </div>
</template>
