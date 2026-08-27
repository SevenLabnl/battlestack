<script setup lang="ts">
import { computed } from 'vue'

// Port of the `Avatar` export of components/display/Avatar.jsx.
// With no `src` the vendored `.bs-avatar` paints initials on --primary-tint; the
// image, when present, fills the same box.
const SIZES = { sm: 24, md: 32, lg: 40 } as const

const KNOWN_STATUS = ['online', 'away', 'offline'] as const

const props = withDefaults(defineProps<{
    name?: string
    src?: string
    /** sm 24 / md 32 / lg 40, or an explicit diameter in px. */
    size?: 'sm' | 'md' | 'lg' | number
    /** 'online' | 'away' | 'offline'; any other string is used as a raw dot colour. */
    status?: string
}>(), {
    name: '',
    src: undefined,
    size: 'md',
    status: undefined,
})

const px = computed(() => (typeof props.size === 'number' ? props.size : SIZES[props.size]))

const initials = computed(() => props.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase())

const isKnownStatus = computed(() => KNOWN_STATUS.includes(props.status as typeof KNOWN_STATUS[number]))

// The reference only names the person, which leaves the status dot as colour
// alone. Naming the status in the label is the a11y fix; a caller-supplied colour
// string is not a status word, so it keeps the reference's `title` only.
const label = computed(() => {
    const base = props.name || 'avatar'
    return isKnownStatus.value ? `${base}, ${props.status}` : base
})

const statusClass = computed(() => (isKnownStatus.value ? `bs-avatar__status--${props.status}` : ''))
const statusStyle = computed(() => (isKnownStatus.value ? undefined : { background: props.status }))
</script>

<template>
    <span
        class="bs-avatar"
        :style="{ '--av': `${px}px` }"
        role="img"
        :aria-label="label"
    >
        <img
            v-if="src"
            :src="src"
            alt=""
        />
        <template v-else>{{ initials || '?' }}</template>
        <span
            v-if="status"
            class="bs-avatar__status"
            :class="statusClass"
            :style="statusStyle"
            :title="status"
        />
    </span>
</template>
