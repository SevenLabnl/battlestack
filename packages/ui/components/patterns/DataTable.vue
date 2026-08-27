<script setup lang="ts">
import { computed, defineComponent, getCurrentInstance, type PropType, type VNodeChild } from 'vue'
import Button from '../actions/Button.vue'
import EmptyState from '../display/EmptyState.vue'
import Skeleton from '../display/Skeleton.vue'
import Checkbox from '../forms/Checkbox.vue'
import Icon from '../icons/Icon.vue'
import Pagination from '../navigation/Pagination.vue'

export type DataRow = Record<string, unknown>
export type RowKey = string | number

export interface DataColumn {
    key: string
    /** Column heading. Use the #header-<key> slot for anything richer than text. */
    header?: string
    width?: string
    align?: 'left' | 'right'
    sortable?: boolean
    /** Pre-slot fallback for a cell's content — see the note on cells below. */
    render?: (row: DataRow) => VNodeChild
}

export interface DataSort {
    key: string
    dir: 'asc' | 'desc'
}

export interface DataPagination {
    page: number
    pageCount: number
    /** Pre-emit fallback; @page-change is the Vue-native path. */
    onChange?: (page: number) => void
    summary?: string
}

// Port of components/patterns/DataTable.jsx. Prop names, the column contract and
// the sort shape come literally from DataTable.d.ts. The React→Vue mapping:
//
//   selected + onSelectedChange   ->  v-model:selected
//   sort     + onSortChange       ->  v-model:sort
//   onRowClick                    ->  @row-click
//   emptyState (ReactNode)        ->  #empty slot
//   column.render(row)            ->  #cell-<key> scoped slot, render kept as fallback
//   column.header (ReactNode)     ->  #header-<key> scoped slot, header prop for text
//   pagination.summary            ->  #summary slot, summary prop for text
//
// Cells resolve in that order: the #cell-<key> slot if the caller filled it,
// otherwise the column's `render` function, otherwise the raw `row[key]`. Both
// paths are live — a caller porting a column config straight off the reference
// keeps working, and a caller writing Vue gets a template with the row, the raw
// value, the column and the row index in scope.
//
// What this port adds over the reference, all of it from the binding table rules:
// a bulk bar above the table whenever something is selected, aria-sort="none" on
// the sortable columns that are not the sorted one, row checkboxes named after
// the row rather than after its id, skeleton rows hidden from assistive tech
// while the table announces itself busy, and a "no results" empty state that is
// not the same as "no data".
const props = withDefaults(defineProps<{
    columns?: DataColumn[]
    rows?: DataRow[]
    /** Which field holds each row's identity. */
    rowKey?: string
    selectable?: boolean
    /** Renders 5 skeleton rows. Never a spinner over a table. */
    loading?: boolean
    pagination?: DataPagination
    compact?: boolean
}>(), {
    columns: () => [],
    rows: () => [],
    rowKey: 'id',
    selectable: false,
    loading: false,
    pagination: undefined,
    compact: false,
})

const selected = defineModel<RowKey[]>('selected', { default: () => [] })
const sort = defineModel<DataSort | null>('sort', { default: null })

const emit = defineEmits<{
    rowClick: [row: DataRow]
    /** Only bound when the current view is filtered — see the empty state below. */
    clearFilters: []
    pageChange: [page: number]
}>()

const instance = getCurrentInstance()

// A cell's `render` returns a node, not a string, so it cannot go through an
// interpolation. This renders whatever the function returns — VNode, string,
// array — and nothing of its own.
const RenderCell = defineComponent({
    name: 'BsDataTableCell',
    props: {
        render: { type: Function as PropType<(row: DataRow) => VNodeChild>, required: true },
        row: { type: Object as PropType<DataRow>, required: true },
    },
    setup: (cellProps) => () => cellProps.render(cellProps.row),
})

const tableClasses = computed(() => [
    'bs-table',
    'bs-table--hover',
    props.compact ? 'bs-table--compact' : '',
].filter(Boolean))

const colCount = computed(() => props.columns.length + (props.selectable ? 1 : 0))
const keys = computed(() => props.rows.map((row) => keyOf(row)))
const allSelected = computed(() => props.rows.length > 0 && keys.value.every((k) => selected.value.includes(k)))
const someSelected = computed(() => keys.value.some((k) => selected.value.includes(k)))
const bodyRows = computed(() => (props.loading ? [] : props.rows))
const skeletonRows = computed(() => (props.loading ? 5 : 0))

function keyOf(row: DataRow): RowKey {
    return row[props.rowKey] as RowKey
}

// The reference names a row checkbox "Select row 42", which is the database's
// name for the row, not the user's. The first column is the one the table is
// keyed on visually, so its value is what identifies the row out loud; the id is
// the fallback for a first column that renders something other than text.
function rowLabel(row: DataRow): string {
    const first = props.columns[0]
    const value = first ? row[first.key] : undefined
    if (typeof value === 'string' || typeof value === 'number') return `Select ${value}`
    return `Select row ${keyOf(row)}`
}

function toggleAll() {
    selected.value = allSelected.value
        ? selected.value.filter((k) => !keys.value.includes(k))
        : [...new Set([...selected.value, ...keys.value])]
}

function toggleRow(key: RowKey) {
    selected.value = selected.value.includes(key)
        ? selected.value.filter((k) => k !== key)
        : [...selected.value, key]
}

function clearSelection() {
    selected.value = []
}

function sortIcon(column: DataColumn) {
    if (!sort.value || sort.value.key !== column.key) return 'chevrons-up-down'
    return sort.value.dir === 'asc' ? 'chevron-up' : 'chevron-down'
}

// asc -> desc -> unsorted, the reference's cycle. Unsorted is null and not a
// third direction: a table with no sort applied is a real state.
function cycleSort(column: DataColumn) {
    if (!sort.value || sort.value.key !== column.key) {
        sort.value = { key: column.key, dir: 'asc' }
    } else {
        sort.value = sort.value.dir === 'asc' ? { key: column.key, dir: 'desc' } : null
    }
}

// The reference leaves every other column's aria-sort off, which tells a screen
// reader user that only one column can be sorted at all. "none" is what marks the
// rest as sortable-but-unsorted.
function ariaSort(column: DataColumn) {
    if (sort.value && sort.value.key === column.key) {
        return sort.value.dir === 'asc' ? 'ascending' : 'descending'
    }
    return column.sortable ? 'none' : undefined
}

// Both read off the vnode rather than $attrs: a declared emit is stripped from
// $attrs, and vnode.props is not reactive, so these are functions called from the
// template rather than computeds.
function isRowClickable() {
    return Boolean(instance?.vnode.props?.onRowClick)
}

function isFiltered() {
    return Boolean(instance?.vnode.props?.onClearFilters)
}

// A row click opens the detail; a click on something inside the row that has its
// own job — the checkbox, the row-actions menu, a link — does not. The reference
// makes every caller remember to stop propagation by hand.
function onRowClick(row: DataRow, event: MouseEvent) {
    const target = event.target as HTMLElement | null
    if (target?.closest('button, a, input, label, select, textarea, [role="menuitem"]')) return
    emit('rowClick', row)
}

function onPageChange(page: number) {
    emit('pageChange', page)
    props.pagination?.onChange?.(page)
}
</script>

<template>
    <div class="bs-datatable">
        <div
            v-if="selectable && selected.length > 0"
            class="bs-bulkbar"
        >
            <span>{{ selected.length }} selected</span>
            <slot
                name="bulk"
                :selected="selected"
                :count="selected.length"
                :clear="clearSelection"
            />
            <span class="bs-bulkbar__spacer" />
            <Button
                size="sm"
                variant="ghost"
                @click="clearSelection"
            >
                Clear selection
            </Button>
        </div>
        <div class="bs-tablewrap">
            <table
                :class="tableClasses"
                :aria-busy="loading || undefined"
            >
                <thead>
                    <tr>
                        <th
                            v-if="selectable"
                            class="bs-table__select"
                        >
                            <Checkbox
                                :model-value="allSelected"
                                :indeterminate="!allSelected && someSelected"
                                aria-label="Select all rows"
                                @update:model-value="toggleAll"
                            />
                        </th>
                        <th
                            v-for="column in columns"
                            :key="column.key"
                            :class="column.align === 'right' ? 'bs-table__num' : ''"
                            :style="column.width ? { width: column.width } : undefined"
                            :aria-sort="ariaSort(column)"
                        >
                            <button
                                v-if="column.sortable"
                                type="button"
                                class="bs-th-sort"
                                @click="cycleSort(column)"
                            >
                                <slot
                                    :name="`header-${column.key}`"
                                    :column="column"
                                >
                                    {{ column.header }}
                                </slot>
                                <Icon
                                    :name="sortIcon(column)"
                                    :size="13"
                                />
                            </button>
                            <slot
                                v-else
                                :name="`header-${column.key}`"
                                :column="column"
                            >
                                {{ column.header }}
                            </slot>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="line in skeletonRows"
                        :key="`skeleton-${line}`"
                        aria-hidden="true"
                    >
                        <td
                            v-if="selectable"
                            class="bs-table__select"
                        >
                            <Skeleton
                                :width="16"
                                :height="16"
                            />
                        </td>
                        <td
                            v-for="column in columns"
                            :key="column.key"
                        >
                            <Skeleton
                                variant="text"
                                :width="line % 2 ? '90%' : '70%'"
                            />
                        </td>
                    </tr>
                    <tr v-if="!loading && rows.length === 0">
                        <td
                            :colspan="colCount"
                            class="bs-table__empty"
                        >
                            <slot name="empty">
                                <EmptyState
                                    v-if="isFiltered()"
                                    icon="search"
                                    title="No results"
                                    description="No records match the current search or filters."
                                >
                                    <template #action>
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            @click="emit('clearFilters')"
                                        >
                                            Clear filters
                                        </Button>
                                    </template>
                                </EmptyState>
                                <EmptyState
                                    v-else
                                    title="Nothing here yet"
                                    description="No records match the current view."
                                />
                            </slot>
                        </td>
                    </tr>
                    <tr
                        v-for="(record, index) in bodyRows"
                        :key="keyOf(record)"
                        :class="isRowClickable() ? 'bs-table__row--clickable' : ''"
                        :aria-selected="selected.includes(keyOf(record)) || undefined"
                        :tabindex="isRowClickable() ? 0 : undefined"
                        @click="isRowClickable() && onRowClick(record, $event)"
                        @keydown.enter.self="isRowClickable() && emit('rowClick', record)"
                    >
                        <td
                            v-if="selectable"
                            class="bs-table__select"
                            @click.stop
                        >
                            <Checkbox
                                :model-value="selected.includes(keyOf(record))"
                                :aria-label="rowLabel(record)"
                                @update:model-value="toggleRow(keyOf(record))"
                            />
                        </td>
                        <td
                            v-for="column in columns"
                            :key="column.key"
                            :class="column.align === 'right' ? 'bs-table__num' : ''"
                        >
                            <slot
                                :name="`cell-${column.key}`"
                                :row="record"
                                :value="record[column.key]"
                                :column="column"
                                :index="index"
                            >
                                <RenderCell
                                    v-if="column.render"
                                    :render="column.render"
                                    :row="record"
                                />
                                <template v-else>
                                    {{ record[column.key] }}
                                </template>
                            </slot>
                        </td>
                    </tr>
                </tbody>
            </table>
            <div
                v-if="pagination"
                class="bs-tablefoot"
            >
                <span class="bs-small bs-muted">
                    <slot name="summary">{{ pagination.summary }}</slot>
                </span>
                <Pagination
                    :page="pagination.page"
                    :page-count="pagination.pageCount"
                    @update:page="onPageChange"
                />
            </div>
        </div>
    </div>
</template>
