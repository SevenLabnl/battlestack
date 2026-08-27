<script setup lang="ts">
import { computed } from 'vue'
import Icon from '../icons/Icon.vue'

// Port of components/navigation/Pagination.jsx. `page` + `onChange` become
// `v-model:page` per the React→Vue mapping table; `pageCount` keeps its spelling
// from Pagination.d.ts.
//
// Deliberately dumb: it renders page controls and nothing else. The count summary
// that sits beside it in a table footer belongs to the caller, which is the only
// side that knows what is being counted.
const props = withDefaults(defineProps<{
    pageCount?: number
}>(), {
    pageCount: 1,
})

const page = defineModel<number>('page', { default: 1 })

// The reference's window, kept literally: up to seven pages render in full, past
// that it is first, a three-wide window around the current page, last, with a gap
// marker wherever the window does not touch an end.
const windowed = computed<(number | '…')[]>(() => {
    const count = props.pageCount
    if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1)
    const out: (number | '…')[] = [1]
    const lo = Math.max(2, page.value - 1)
    const hi = Math.min(count - 1, page.value + 1)
    if (lo > 2) out.push('…')
    for (let p = lo; p <= hi; p++) out.push(p)
    if (hi < count - 1) out.push('…')
    out.push(count)
    return out
})

function go(target: number) {
    if (target >= 1 && target <= props.pageCount) page.value = target
}
</script>

<template>
    <nav
        class="bs-pagination"
        aria-label="Pagination"
    >
        <button
            type="button"
            class="bs-page"
            :disabled="page <= 1"
            aria-label="Previous page"
            @click="go(page - 1)"
        >
            <Icon
                name="chevron-left"
                :size="16"
            />
        </button>
        <template
            v-for="(entry, i) in windowed"
            :key="`${entry}-${i}`"
        >
            <!-- The gap is decorative: a screen reader reading "1 … 4" would only
                 hear an ellipsis where the pages it skips are already implied. -->
            <span
                v-if="entry === '…'"
                class="bs-page bs-page--gap"
                aria-hidden="true"
            >…</span>
            <button
                v-else
                type="button"
                class="bs-page"
                :aria-current="entry === page ? 'page' : undefined"
                @click="go(entry)"
            >
                {{ entry }}
            </button>
        </template>
        <button
            type="button"
            class="bs-page"
            :disabled="page >= pageCount"
            aria-label="Next page"
            @click="go(page + 1)"
        >
            <Icon
                name="chevron-right"
                :size="16"
            />
        </button>
    </nav>
</template>
