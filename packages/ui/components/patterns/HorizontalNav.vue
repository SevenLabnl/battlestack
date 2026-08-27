<script setup lang="ts">
import { computed, useSlots } from 'vue'
import Badge from '../display/Badge.vue'
import DropdownMenu from '../navigation/DropdownMenu.vue'
import Icon from '../icons/Icon.vue'

interface MenuAction {
    label: string
    /** Glyph name for BsIcon, e.g. 'sparkles'. */
    icon?: string
    danger?: boolean
    disabled?: boolean
    onSelect?: () => void
}

interface MenuHeading {
    heading: string
}

/** Same union BsDropdownMenu takes, literal `'sep'` included. */
type MenuEntry = MenuAction | MenuHeading | 'sep'

interface HorizontalNavItem {
    id?: string
    label: string
    /** Glyph name for BsIcon; only rendered when `icons` is set. */
    icon?: string
    /** Short count or status text. Anything richer goes through the #badge slot. */
    badge?: string | number
    current?: boolean
    onClick?: (event: MouseEvent) => void
    href?: string
    /** Turns the item into a dropdown trigger; a chevron is appended. */
    menu?: MenuEntry[]
    /** Which edge the dropdown aligns to. */
    menuAlign?: 'left' | 'right'
}

// Port of components/patterns/HorizontalNav.jsx — the top-nav layout's navigation,
// used inside BsTopNav when AppShell has no sidebar (>6 sections or grouped nav go
// to BsSidebarNav instead; guidelines/ux-patterns.md forbids both at once).
//
// `brand`, `items`, `icons` and the item shape keep the spelling from
// HorizontalNav.d.ts. `logo` is a ReactNode there, so it is the `#logo` slot;
// per-item `icon` is a glyph name and `badge` has a string shorthand plus a scoped
// `#badge` slot, matching BsSidebarNav. `icons` stays false by default: the
// guidelines put icons in the sidebar and keep the horizontal bar text-only.
//
// `menu` items are handed to the already-ported navigation/DropdownMenu.vue rather
// than reimplemented — that is where the roving focus, typeahead, Escape and
// outside-press behaviour lives. Reka's trigger uses `as-child`, so the element
// that lands in the DOM is still our own `button.bs-topnav__navitem`, and the
// `aria-expanded` Reka sets on it is exactly what
// `.bs-topnav__navitem[aria-expanded="true"]` in styles/vendor/patterns.css styles.
// The only DOM Reka adds is DropdownMenu's own `span.bs-anchor` wrapper around the
// trigger; the flex row treats it as the item, so the layout is unchanged.
//
// HorizontalNav.d.ts flattens the menu entry into one `HorizontalNavMenuItem` with
// both `label?` and `heading?` optional. That is the same union DropdownMenu.d.ts
// declares properly, so it is declared properly here — see the report.
const props = withDefaults(defineProps<{
    /** Wordmark text next to the lettermark chip. */
    brand?: string
    items?: HorizontalNavItem[]
    /** Show item icons. Text-only by default. */
    icons?: boolean
}>(), {
    brand: undefined,
    items: () => [],
    icons: false,
})

const slots = useSlots()

const letter = computed(() => (props.brand || 'B')[0])

const hasBrand = computed(() => Boolean(props.brand || slots.logo))

const hasBadge = (item: HorizontalNavItem) => item.badge != null && item.badge !== ''

// a11y, beyond the reference:
// - The <nav>'s name defaults to "Main" and falls through, so a second navigation
//   region on the page can be named. The reference hardcodes it in both this
//   component and SidebarNav.
// - The item row is a real list, so the bar announces how many sections there are.
// - Buttons are `type="button"`; the reference omits it on the plain item, which
//   would submit a surrounding form.
// The reference's inline `display:flex` on the <nav> is `.bs-hnav` in
// styles/extra/patterns-shell.css; a caller's own `style` still falls through and
// still wins over it, which is what the reference's `{...style}` spread did.
</script>

<template>
    <nav
        class="bs-hnav"
        aria-label="Main"
    >
        <span
            v-if="hasBrand"
            class="bs-topnav__brand"
        >
            <slot name="logo">
                <span
                    class="bs-sidenav__logo"
                    aria-hidden="true"
                >{{ letter }}</span>
            </slot>
            <span v-if="brand">{{ brand }}</span>
        </span>
        <ul class="bs-topnav__nav">
            <li
                v-for="item in items"
                :key="item.id || item.label"
            >
                <DropdownMenu
                    v-if="item.menu"
                    :items="item.menu"
                    :align="item.menuAlign"
                    :label="item.label"
                >
                    <template #trigger>
                        <button
                            type="button"
                            class="bs-topnav__navitem"
                            :aria-current="item.current ? 'page' : undefined"
                        >
                            <slot
                                v-if="icons"
                                name="icon"
                                :item="item"
                            >
                                <Icon
                                    v-if="item.icon"
                                    :name="item.icon"
                                    :size="17"
                                />
                            </slot>
                            {{ item.label }}
                            <slot
                                name="badge"
                                :item="item"
                            >
                                <Badge
                                    v-if="hasBadge(item)"
                                    tone="primary"
                                >
                                    {{ item.badge }}
                                </Badge>
                            </slot>
                            <span
                                class="bs-topnav__navchevron"
                                aria-hidden="true"
                            >
                                <Icon
                                    name="chevron-down"
                                    :size="15"
                                />
                            </span>
                        </button>
                    </template>
                </DropdownMenu>
                <component
                    :is="item.href ? 'a' : 'button'"
                    v-else
                    class="bs-topnav__navitem"
                    :type="item.href ? undefined : 'button'"
                    :href="item.href"
                    :aria-current="item.current ? 'page' : undefined"
                    @click="item.onClick?.($event)"
                >
                    <slot
                        v-if="icons"
                        name="icon"
                        :item="item"
                    >
                        <Icon
                            v-if="item.icon"
                            :name="item.icon"
                            :size="17"
                        />
                    </slot>
                    {{ item.label }}
                    <slot
                        name="badge"
                        :item="item"
                    >
                        <Badge
                            v-if="hasBadge(item)"
                            tone="primary"
                        >
                            {{ item.badge }}
                        </Badge>
                    </slot>
                </component>
            </li>
        </ul>
    </nav>
</template>
