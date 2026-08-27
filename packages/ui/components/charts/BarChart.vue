<script setup lang="ts">
import { computed } from 'vue'
import type { BarDatum } from './types'

// Port of components/charts/BarChart.jsx. The reference draws the bars with divs,
// not SVG ("CSS bars" is what BarChart.prompt.md specifies), so this port keeps the
// div markup: it is already fluid in width, and only the plot height is fixed.
//
// Every inline style from the reference moved to styles/extra/charts.css; the two
// values that genuinely vary per instance (plot height, bar height and colour) stay
// inline as custom properties.

const props = withDefaults(defineProps<{
    data: BarDatum[]
    /** Height of the plot area in px, excluding the category labels underneath. */
    height?: number
    /** Default bar colour. Categorical token only. */
    color?: string
    /** Formats the axis ticks, the hover titles and the value labels. Put units here. */
    formatValue?: (v: number) => string
    /** Prints the value above each bar. */
    showValues?: boolean
    /** Describe what the chart shows — this is the chart's accessible name. */
    ariaLabel?: string
}>(), {
    height: 170,
    color: 'var(--chart-1)',
    formatValue: (v: number) => String(v),
    showValues: false,
    ariaLabel: undefined,
})

const max = computed(() => Math.max(...props.data.map((d) => d.value), 1))

// The reference's three tick stops, top to bottom.
const ticks = [1, 0.5, 0]

const label = computed(() => props.ariaLabel || 'Bar chart')

function barStyle(d: BarDatum) {
    return {
        // Math.max(..., 1) keeps a zero bar visible as a hairline, as the reference does.
        '--bs-bar-h': `${Math.max((d.value / max.value) * 100, 1)}%`,
        '--bs-bar-color': d.color || props.color,
    }
}
</script>

<template>
    <div class="bs-barchart">
        <!-- role="img" hides the plot's internals from assistive tech, which is what
             makes a chart readable at all; the visually hidden table below carries the
             numbers so they stay reachable. -->
        <div
            class="bs-barchart__plot"
            role="img"
            :aria-label="label"
            :style="{ '--bs-barchart-h': `${height}px` }"
        >
            <div class="bs-barchart__axis">
                <span
                    v-for="t in ticks"
                    :key="t"
                    class="bs-caption bs-barchart__tick"
                >{{ formatValue(Math.round(max * t)) }}</span>
            </div>
            <div class="bs-barchart__area">
                <div
                    v-for="t in ticks"
                    :key="t"
                    aria-hidden="true"
                    class="bs-barchart__grid"
                    :class="`bs-barchart__grid--${t * 100}`"
                />
                <div class="bs-barchart__bars">
                    <div
                        v-for="d in data"
                        :key="d.label"
                        class="bs-barchart__col"
                        :title="`${d.label}: ${formatValue(d.value)}`"
                    >
                        <div class="bs-barchart__track">
                            <span
                                v-if="showValues"
                                class="bs-caption bs-barchart__value"
                            >{{ formatValue(d.value) }}</span>
                            <div
                                class="bs-barchart__bar"
                                :style="barStyle(d)"
                            />
                        </div>
                        <span class="bs-caption bs-barchart__label">{{ d.label }}</span>
                    </div>
                </div>
            </div>
        </div>
        <table class="bs-visually-hidden">
            <caption>{{ label }}</caption>
            <thead>
                <tr>
                    <th scope="col">
                        Category
                    </th>
                    <th scope="col">
                        Value
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr
                    v-for="d in data"
                    :key="d.label"
                >
                    <th scope="row">
                        {{ d.label }}
                    </th>
                    <td>{{ formatValue(d.value) }}</td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
