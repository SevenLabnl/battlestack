<script setup lang="ts">
import {
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuPortal,
    DropdownMenuRoot,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from 'reka-ui'
import Icon from '../icons/Icon.vue'

interface MenuAction {
    label: string
    /** Glyph name for BsIcon, e.g. 'pencil'. */
    icon?: string
    danger?: boolean
    disabled?: boolean
    onSelect?: () => void
}

interface MenuHeading {
    heading: string
}

/** The union from DropdownMenu.d.ts, literal `'sep'` included. */
type MenuEntry = MenuAction | MenuHeading | 'sep'

// Port of components/navigation/DropdownMenu.jsx. `trigger` is a ReactElement
// there, so it is the `#trigger` slot here; `items`, `align` and `label` keep the
// spelling from DropdownMenu.d.ts, and so does the MenuEntry union.
//
// This is the component the export itself calls prototype-grade: its menu has no
// roving focus and no typeahead, and it re-implements outside-click, Escape and
// scroll repositioning by hand. Reka's menu primitives supply all of it —
// role="menu"/"menuitem" semantics, arrows, Home/End, typeahead, Escape, outside
// click, focus return to the trigger — while `as-child` keeps the reference's own
// elements and bs- classes.
//
// The wrapper is the reference's `span.bs-anchor`. DropdownMenuRoot renders no DOM
// of its own and the panel teleports to document.body, so what lands in the page is
// `span.bs-anchor > trigger`, exactly as in the reference.
withDefaults(defineProps<{
    items?: MenuEntry[]
    align?: 'left' | 'right'
    /** Accessible name for the menu itself; falls back to the trigger's name. */
    label?: string
}>(), {
    items: () => [],
    align: 'left',
    label: undefined,
})

const isHeading = (entry: MenuEntry): entry is MenuHeading =>
    typeof entry === 'object' && 'heading' in entry
</script>

<template>
    <span class="bs-anchor">
        <!-- modal=false: the reference leaves the page scrollable behind an open
             menu and repositions the panel as it scrolls. Reka's modal mode would
             lock body scroll and make the rest of the page inert instead. -->
        <DropdownMenuRoot :modal="false">
            <DropdownMenuTrigger as-child>
                <slot name="trigger" />
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
                <!-- side-offset 4 is the reference's `r.bottom + 4`; align start /
                     end is its left / right. Reka positions with a fixed strategy
                     and reflows on scroll and resize, which is what .bs-menu--fixed
                     asks for. text-value below pins typeahead to the label, so an
                     item's icon cannot pollute what the user is typing against. -->
                <DropdownMenuContent
                    as-child
                    :side-offset="4"
                    :align="align === 'right' ? 'end' : 'start'"
                    :aria-label="label"
                >
                    <div :class="['bs-menu', 'bs-menu--fixed', align === 'right' ? 'bs-menu--right' : '']">
                        <template
                            v-for="(entry, i) in items"
                            :key="i"
                        >
                            <DropdownMenuSeparator
                                v-if="entry === 'sep'"
                                as-child
                            >
                                <div class="bs-menu__sep" />
                            </DropdownMenuSeparator>
                            <DropdownMenuLabel
                                v-else-if="isHeading(entry)"
                                as-child
                            >
                                <div class="bs-menu__label">
                                    {{ entry.heading }}
                                </div>
                            </DropdownMenuLabel>
                            <DropdownMenuItem
                                v-else
                                as-child
                                :disabled="entry.disabled"
                                :text-value="entry.label"
                                @select="entry.onSelect?.()"
                            >
                                <button
                                    type="button"
                                    :class="['bs-menu__item', entry.danger ? 'bs-menu__item--danger' : '']"
                                    :disabled="entry.disabled"
                                >
                                    <Icon
                                        v-if="entry.icon"
                                        :name="entry.icon"
                                        :size="15"
                                    />
                                    {{ entry.label }}
                                </button>
                            </DropdownMenuItem>
                        </template>
                    </div>
                </DropdownMenuContent>
            </DropdownMenuPortal>
        </DropdownMenuRoot>
    </span>
</template>
