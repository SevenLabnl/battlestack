<script setup lang="ts">
import { computed } from 'vue'
import type { LineSeries } from './types'

// Port of components/charts/LineChart.jsx. The geometry (viewBox 560 wide, the
// paddings, the tick stops, the dash patterns) is copied from the reference so the
// chart looks identical; what this port adds is `preserveAspectRatio` plus a
// width:100%/height:auto rule, so the SVG scales with its card instead of only
// stretching horizontally, and a visually hidden data table.

const props = withDefaults(defineProps<{
    series: LineSeries[]
    labels: string[]
    /** Height of the viewBox in px; the rendered height follows the container width. */
    height?: number
    /** Fill under every solid series. */
    area?: boolean
    /** Formats the axis ticks and the hover titles. Put units here. */
    formatValue?: (v: number) => string
    /** Describe what the chart shows — this is the chart's accessible name. */
    ariaLabel?: string
}>(), {
    height: 200,
    area: true,
    formatValue: (v: number) => String(v),
    ariaLabel: undefined,
})

// Reference geometry, in user units.
const W = 560
const PAD_L = 38
const PAD_R = 10
const PAD_T = 10
const PAD_B = 22

/** Grid + tick stops, bottom to top. */
const ticks = [0, 0.25, 0.5, 0.75, 1]

const max = computed(() => Math.max(...props.series.flatMap((s) => s.points), 1))
const columns = computed(() => Math.max(...props.series.map((s) => s.points.length), 2))

const x = (i: number) => PAD_L + (i / (columns.value - 1)) * (W - PAD_L - PAD_R)
const y = (v: number) => PAD_T + (1 - v / max.value) * (props.height - PAD_T - PAD_B)

// The reference thins the x labels to at most 8. Math.max(..., 1) guards `i % 0`.
const every = computed(() => Math.max(Math.ceil(props.labels.length / 8), 1))

const label = computed(() => props.ariaLabel || 'Line chart')

// Only --chart-1…5 exist, so the index wraps rather than resolving to a colour the
// theme never defined. The guidelines cap a line chart at three series anyway.
const seriesColor = (s: LineSeries, i: number) => s.color || `var(--chart-${(i % 5) + 1})`

const lines = computed(() => props.series.map((s, i) => {
    const points = s.points.map((v, j) => `${x(j)},${y(v)}`).join(' ')
    return {
        key: s.name || i,
        series: s,
        color: seriesColor(s, i),
        points,
        // Closed shape: baseline, the line, back down to the baseline.
        area: `${x(0)},${y(0)} ${points} ${x(s.points.length - 1)},${y(0)}`,
        dots: s.points.map((v, j) => ({
            cx: x(j),
            cy: y(v),
            title: `${s.name ? `${s.name} · ` : ''}${props.labels[j] ?? j}: ${props.formatValue(v)}`,
        })),
    }
}))

const rowHeader = (s: LineSeries, i: number) => s.name || `Series ${i + 1}`
</script>

<template>
    <div class="bs-linechart">
        <!-- role="img" on the SVG, not on the wrapper: it keeps the legend and the
             hidden data table below reachable, which is where the numbers live. -->
        <svg
            class="bs-linechart__svg"
            role="img"
            :aria-label="label"
            width="100%"
            :viewBox="`0 0 ${W} ${height}`"
            preserveAspectRatio="xMidYMid meet"
        >
            <g
                v-for="t in ticks"
                :key="`grid-${t}`"
            >
                <line
                    :x1="PAD_L"
                    :x2="W - PAD_R"
                    :y1="y(max * t)"
                    :y2="y(max * t)"
                    class="bs-linechart__grid"
                    :stroke-dasharray="t === 0 ? undefined : '3 4'"
                />
                <text
                    :x="PAD_L - 6"
                    :y="y(max * t) + 3"
                    text-anchor="end"
                    class="bs-linechart__tick"
                >{{ formatValue(Math.round(max * t)) }}</text>
            </g>
            <template
                v-for="(l, i) in labels"
                :key="`label-${i}`"
            >
                <text
                    v-if="i % every === 0"
                    :x="x(i)"
                    :y="height - 6"
                    text-anchor="middle"
                    class="bs-linechart__tick"
                >{{ l }}</text>
            </template>
            <g
                v-for="line in lines"
                :key="line.key"
                :style="{ '--bs-line-color': line.color }"
            >
                <polygon
                    v-if="area && !line.series.dashed"
                    class="bs-linechart__area"
                    :points="line.area"
                />
                <polyline
                    class="bs-linechart__line"
                    :points="line.points"
                    :stroke-dasharray="line.series.dashed ? '5 5' : undefined"
                />
                <circle
                    v-for="(dot, i) in (line.series.dashed ? [] : line.dots)"
                    :key="i"
                    class="bs-linechart__dot"
                    :cx="dot.cx"
                    :cy="dot.cy"
                    r="2.4"
                ><title>{{ dot.title }}</title></circle>
            </g>
        </svg>
        <ul
            v-if="series.length > 1"
            class="bs-linechart__legend"
        >
            <li
                v-for="(s, i) in series"
                :key="s.name || i"
                class="bs-caption bs-linechart__legend-item"
            >
                <span
                    aria-hidden="true"
                    class="bs-linechart__swatch"
                    :class="{ 'bs-linechart__swatch--dashed': s.dashed }"
                    :style="{ '--bs-line-color': seriesColor(s, i) }"
                />
                {{ s.name }}
            </li>
        </ul>
        <table class="bs-visually-hidden">
            <caption>{{ label }}</caption>
            <thead>
                <tr>
                    <th scope="col">
                        Series
                    </th>
                    <th
                        v-for="(l, i) in labels"
                        :key="i"
                        scope="col"
                    >
                        {{ l }}
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr
                    v-for="(s, i) in series"
                    :key="s.name || i"
                >
                    <th scope="row">
                        {{ rowHeader(s, i) }}
                    </th>
                    <td
                        v-for="(v, j) in s.points"
                        :key="j"
                    >
                        {{ formatValue(v) }}
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
