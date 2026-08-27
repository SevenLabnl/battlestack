<script setup lang="ts">
import { computed, useId, useSlots } from 'vue'
import Badge from '../display/Badge.vue'
import Icon from '../icons/Icon.vue'

interface SideNavItem {
    id?: string
    label: string
    /** Glyph name for BsIcon, e.g. 'dashboard'. Defaults to 'folder', as the reference does. */
    icon?: string
    /** Short count or status text. Anything richer goes through the #badge slot. */
    badge?: string | number
    current?: boolean
    onClick?: (event: MouseEvent) => void
    href?: string
}

interface SideNavGroup {
    label?: string
    items: SideNavItem[]
}

// Port of components/patterns/SidebarNav.jsx. `brand`, `groups`, `collapsed` and the
// item/group shapes keep the spelling from SidebarNav.d.ts; `logo` and `footer` are
// ReactNode there, so they are slots here, and per-item `icon` is a glyph name
// string, matching how navigation/Tabs.vue and navigation/DropdownMenu.vue already
// express the same field. The two per-item ReactNodes get scoped slots — `#icon`
// and `#badge`, both receiving `{ item }` — with the string/number shorthand on the
// item itself covering everything the reference actually passes. A `#footer` that
// should disappear when collapsed takes the condition on the slot itself
// (`<template v-if="!collapsed" #footer>`), the way the reference passes
// `footer={!collapsed && …}`.
//
// ── The --nav-* contract ─────────────────────────────────────────────────────
// The sidebar is ink chrome in *both* themes, and a client relights it by
// overriding the `--nav-*` group alone. So every colour, border and hover state
// under `.bs-sidenav` resolves through `--nav-bg`, `--nav-fg`, `--nav-fg-muted`,
// `--nav-border`, `--nav-hover`, `--nav-active-bg`, `--nav-active-fg`, `--nav-edge`,
// `--nav-logo-bg` and `--nav-logo-fg` — never `--bg`/`--fg`. All of that already
// lives in styles/vendor/patterns.css; this component only produces the classes,
// and the rules it adds in styles/extra/patterns-shell.css are layout-only
// (justify-content, padding, ellipsis) so nothing can leak a page-surface colour
// into the sidebar.
const props = withDefaults(defineProps<{
    /** Wordmark text. Its first letter is the default lettermark chip. */
    brand?: string
    groups?: SideNavGroup[]
    /** Icons only: hides the wordmark, group headings, labels and badges. */
    collapsed?: boolean
}>(), {
    brand: 'Battlestack',
    groups: () => [],
    collapsed: false,
})

const slots = useSlots()

const letter = computed(() => (props.brand || 'B')[0])

// One id per instance, suffixed per group, so two sidebars on a page cannot collide.
const uid = useId()
const groupLabelId = (index: number) => `${uid}-group-${index}`

const classes = computed(() => ['bs-sidenav', props.collapsed ? 'bs-sidenav--collapsed' : ''].filter(Boolean))

const hasFooter = computed(() => Boolean(slots.footer))

// a11y, beyond the reference:
// - The nav's accessible name defaults to "Main" but falls through, so an app with
//   a second navigation region can name it. The reference hardcodes "Main" in both
//   SidebarNav and HorizontalNav, which would give a page two identically named
//   landmarks if it ever rendered both (ux-patterns.md forbids that, but a label a
//   caller cannot change is still the wrong default).
// - Each group's items are a real list, and the group's own heading names it
//   (aria-labelledby). Collapsed, the visible heading is gone, so the name moves to
//   aria-label — the reference simply drops the grouping for icon-only users.
// - A collapsed item has no visible text, so `aria-label` carries the label. The
//   reference relies on `title` alone, which is a tooltip first and a name only by
//   fallback.
// - Buttons are `type="button"`: the reference omits it, so a sidebar rendered
//   inside a form would submit it. Fallthrough still lets a caller override.
</script>

<template>
    <nav
        :class="classes"
        aria-label="Main"
    >
        <div class="bs-sidenav__brand">
            <slot name="logo">
                <span
                    class="bs-sidenav__logo"
                    aria-hidden="true"
                >{{ letter }}</span>
            </slot>
            <span v-if="!collapsed && brand">{{ brand }}</span>
        </div>
        <div
            v-for="(group, gi) in groups"
            :key="gi"
            class="bs-sidenav__group"
        >
            <div
                v-if="group.label && !collapsed"
                :id="groupLabelId(gi)"
                class="bs-sidenav__grouplabel"
            >
                {{ group.label }}
            </div>
            <ul
                class="bs-sidenav__items"
                :aria-labelledby="group.label && !collapsed ? groupLabelId(gi) : undefined"
                :aria-label="group.label && collapsed ? group.label : undefined"
            >
                <li
                    v-for="item in group.items"
                    :key="item.id || item.label"
                >
                    <component
                        :is="item.href ? 'a' : 'button'"
                        class="bs-sidenav__item"
                        :type="item.href ? undefined : 'button'"
                        :href="item.href"
                        :aria-current="item.current ? 'page' : undefined"
                        :title="collapsed ? item.label : undefined"
                        :aria-label="collapsed ? item.label : undefined"
                        @click="item.onClick?.($event)"
                    >
                        <slot
                            name="icon"
                            :item="item"
                        >
                            <Icon
                                :name="item.icon || 'folder'"
                                :size="17"
                            />
                        </slot>
                        <template v-if="!collapsed">
                            <span class="bs-sidenav__label">{{ item.label }}</span>
                            <slot
                                name="badge"
                                :item="item"
                            >
                                <Badge
                                    v-if="item.badge != null && item.badge !== ''"
                                    class="bs-sidenav__badge"
                                    tone="primary"
                                >
                                    {{ item.badge }}
                                </Badge>
                            </slot>
                        </template>
                    </component>
                </li>
            </ul>
        </div>
        <div
            v-if="hasFooter"
            class="bs-sidenav__footer"
        >
            <slot name="footer" />
        </div>
    </nav>
</template>
