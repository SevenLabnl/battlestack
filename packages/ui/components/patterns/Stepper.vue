<script setup lang="ts">
import Icon from '../icons/Icon.vue'

export interface Step {
    id?: string
    label: string
    description?: string
}

// Port of components/patterns/Stepper.jsx. `steps` is a config array and stays a
// prop, spelled as Stepper.d.ts spells it; `current` is the index of the step in
// progress, and everything before it renders as done.
//
// The reference writes the whole thing in inline styles, including the per-state
// colours. Those are now `[data-state]` rules in styles/extra/patterns-page.css —
// same three states, same tokens, no style attribute in the DOM.
//
// Semantics, per the wizard rules: an ordered list of 3–5 verb-labelled steps,
// the current one carrying aria-current="step" and nothing else carrying it. The
// numbered circle is decorative — the position is already in the <ol> — so the
// label is the only text a screen reader reads, plus a hidden "(completed)" on
// the steps behind. The connector is decorative too.
const props = withDefaults(defineProps<{
    steps?: Step[]
    /** Index of the current step; earlier steps render as done. */
    current?: number
}>(), {
    steps: () => [],
    current: 0,
})

type State = 'done' | 'current' | 'todo'

function stateOf(index: number): State {
    if (index < props.current) return 'done'
    return index === props.current ? 'current' : 'todo'
}

function isLast(index: number) {
    return index === props.steps.length - 1
}
</script>

<template>
    <ol class="bs-stepper">
        <li
            v-for="(step, i) in steps"
            :key="step.id || step.label"
            class="bs-stepper__step"
            :data-state="stateOf(i)"
            :data-last="isLast(i) || undefined"
            :aria-current="stateOf(i) === 'current' ? 'step' : undefined"
        >
            <span class="bs-stepper__item">
                <span
                    class="bs-stepper__marker"
                    aria-hidden="true"
                >
                    <Icon
                        v-if="stateOf(i) === 'done'"
                        name="check"
                        :size="14"
                    />
                    <template v-else>{{ i + 1 }}</template>
                </span>
                <span class="bs-stepper__text">
                    <span class="bs-stepper__label">
                        {{ step.label }}
                        <span
                            v-if="stateOf(i) === 'done'"
                            class="bs-visually-hidden"
                        > (completed)</span>
                    </span>
                    <span
                        v-if="step.description"
                        class="bs-caption bs-stepper__desc"
                    >{{ step.description }}</span>
                </span>
            </span>
            <span
                v-if="!isLast(i)"
                class="bs-stepper__line"
                :data-filled="i < current || undefined"
                aria-hidden="true"
            />
        </li>
    </ol>
</template>
