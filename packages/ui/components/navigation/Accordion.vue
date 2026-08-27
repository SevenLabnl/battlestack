<script setup lang="ts">
import { computed, useId } from 'vue'
import {
    AccordionContent,
    AccordionHeader,
    AccordionItem,
    AccordionRoot,
    AccordionTrigger,
} from 'reka-ui'
import Icon from '../icons/Icon.vue'

interface AccordionEntry {
    id: string
    title: string
    content?: string
}

// Port of components/navigation/Accordion.jsx. Props keep the spelling from
// Accordion.d.ts. `content` is a ReactNode there, so each panel also has a
// `#content-<id>` scoped slot with the string prop as the fallback — the same
// shape Table uses for `#cell-<key>`.
//
// Reka's accordion primitives supply the disclosure behaviour the reference has
// plus the arrow/Home/End navigation between triggers it does not; `as-child`
// keeps the reference's own elements and classes.
const props = withDefaults(defineProps<{
    items?: AccordionEntry[]
    /** Allow several panels open at once */
    multiple?: boolean
    defaultOpen?: string[]
}>(), {
    items: () => [],
    multiple: false,
    defaultOpen: () => [],
})

// Reka models single-open as one value and multi-open as an array; the contract
// speaks in an array either way, so the first entry wins when only one panel may
// be open.
const defaultValue = computed(() => (props.multiple ? props.defaultOpen : props.defaultOpen[0]))

// Reka fills the trigger's aria-controls from an id its content sets during its
// own setup — which runs after the trigger has already rendered, so the attribute
// comes out empty. The reference wired the pair itself (`id={"acc-" + it.id}`);
// this does the same, scoped by a useId so two accordions can carry an item id in
// common. A prop set on the `as-child` element wins over Reka's, so both ends land.
const uid = useId()
const panelId = (id: string) => `${uid}-acc-${id}`
</script>

<template>
    <AccordionRoot
        as-child
        :type="multiple ? 'multiple' : 'single'"
        :default-value="defaultValue"
        collapsible
    >
        <div class="bs-accordion">
            <AccordionItem
                v-for="item in items"
                :key="item.id"
                as-child
                :value="item.id"
            >
                <div class="bs-accordion__item">
                    <!-- The reference wraps the trigger in an <h3> so the panel
                         titles form a heading level; AccordionHeader renders h3
                         by default, which is the same element. -->
                    <AccordionHeader class="bs-accordion__header">
                        <AccordionTrigger as-child>
                            <button
                                type="button"
                                class="bs-accordion__trigger"
                                :aria-controls="panelId(item.id)"
                            >
                                <span>{{ item.title }}</span>
                                <Icon
                                    name="chevron-down"
                                    :size="16"
                                />
                            </button>
                        </AccordionTrigger>
                    </AccordionHeader>
                    <AccordionContent as-child>
                        <div
                            :id="panelId(item.id)"
                            class="bs-accordion__panel"
                        >
                            <slot
                                :name="`content-${item.id}`"
                                :item="item"
                            >
                                {{ item.content }}
                            </slot>
                        </div>
                    </AccordionContent>
                </div>
            </AccordionItem>
        </div>
    </AccordionRoot>
</template>
