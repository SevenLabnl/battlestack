<script setup lang="ts">
import { Comment, Fragment, Text, computed, h, useSlots, type VNode } from 'vue'

// Port of the `AvatarGroup` export of components/display/Avatar.jsx. Vue is one
// component per file, so it lives next to Avatar.vue rather than beside it.
// The vendored CSS overlaps the children and `--av` on the wrapper sizes the
// overflow chip.
const SIZES = { sm: 24, md: 32, lg: 40 } as const

const props = withDefaults(defineProps<{
    /** Avatars rendered before the "+N" chip takes over. */
    max?: number
    size?: 'sm' | 'md' | 'lg' | number
}>(), {
    max: 4,
    size: 'md',
})

const slots = useSlots()

const px = computed(() => (typeof props.size === 'number' ? props.size : SIZES[props.size]))

// React.Children.toArray in Vue terms: unwrap fragments, drop comment
// placeholders (a falsy `v-if`) and whitespace-only text so the count is right.
function flatten(nodes: VNode[]): VNode[] {
    const out: VNode[] = []
    for (const node of nodes) {
        if (node.type === Comment) continue
        if (node.type === Fragment && Array.isArray(node.children)) {
            out.push(...flatten(node.children as VNode[]))
            continue
        }
        if (node.type === Text && typeof node.children === 'string' && node.children.trim() === '') continue
        out.push(node)
    }
    return out
}

// A functional component so the slot is read during render — slicing it in a
// computed would invoke it outside one, which Vue warns about.
const Avatars = () => {
    const all = flatten(slots.default?.() ?? [])
    const shown = all.slice(0, props.max)
    const overflow = all.length - shown.length
    if (overflow <= 0) return shown
    return [...shown, h('span', {
        'class': ['bs-avatar', 'bs-avatar--more'],
        'style': { '--av': `${px.value}px` },
        // The reference labels the chip without a role, which hides the name from
        // assistive tech; role="img" is what makes the label count.
        'role': 'img',
        'aria-label': `${overflow} more`,
    }, `+${overflow}`)]
}
</script>

<template>
    <span
        class="bs-avatargroup"
        :style="{ '--av': `${px}px` }"
    >
        <Avatars />
    </span>
</template>
