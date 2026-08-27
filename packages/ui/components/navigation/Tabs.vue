<script setup lang="ts">
import { TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import Icon from '../icons/Icon.vue'

interface TabItem {
    id: string
    label: string
    /** Glyph name for BsIcon, e.g. 'grid'. */
    icon?: string
    count?: number
}

// Port of components/navigation/Tabs.jsx. `value` + `onChange` become v-model per
// the React→Vue mapping table; `tabs`, `ariaLabel` and the item shape keep the
// spelling from Tabs.d.ts.
//
// The reference wires ArrowLeft/ArrowRight and the roving tabindex by hand and
// stops there — no Home/End, and focus is moved before the DOM has the new
// tabindex. Reka's tabs primitives own that behaviour instead; `as-child` on all
// three keeps our markup, so the rendered DOM is still the reference's
// `div.bs-tabs[role=tablist] > button.bs-tab[role=tab]` and nothing else.
withDefaults(defineProps<{
    tabs?: TabItem[]
    ariaLabel?: string
}>(), {
    tabs: () => [],
    ariaLabel: undefined,
})

const model = defineModel<string>({ required: true })
</script>

<template>
    <TabsRoot
        v-model="model"
        as-child
    >
        <TabsList
            as-child
            :aria-label="ariaLabel"
        >
            <div class="bs-tabs">
                <TabsTrigger
                    v-for="tab in tabs"
                    :key="tab.id"
                    as-child
                    :value="tab.id"
                >
                    <button class="bs-tab">
                        <Icon
                            v-if="tab.icon"
                            :name="tab.icon"
                            :size="16"
                        />
                        {{ tab.label }}
                        <span
                            v-if="tab.count != null"
                            class="bs-tab__count"
                        >{{ tab.count }}</span>
                    </button>
                </TabsTrigger>
            </div>
        </TabsList>
    </TabsRoot>
</template>
