<script setup lang="ts">
import { computed } from 'vue'
import type { DonutDatum } from './types'

// Port of components/charts/DonutChart.jsx. The stroke-dasharray arithmetic is the
// reference's, unchanged. What this port adds: a viewBox so the ring scales with its
// card (the reference pinned width/height in px), a percentage inset for the centre
// overlay so it keeps tracking the ring at any size, and the -90° rotation as an SVG
// transform instead of a CSS one on the element.
//
// centerValue / centerLabel are ReactNode in the reference, so they are slots here,
// with a string prop shorthand for the text-only case the design system shows.

const props = withDefaults(defineProps<{
    /** At most five segments — see the charts rules in guidelines/ux-patterns.md. */
    data: DonutDatum[]
    /** Ring diameter in px. Acts as a max-width; the ring shrinks with a narrow card. */
    size?: number
    /** Ring stroke width in px. */
    thickness?: number
    /** The number in the middle. Use the #centerValue slot for anything richer. */
    centerValue?: string | number
    /** What that number counts. Use the #centerLabel slot for anything richer. */
    centerLabel?: string
    /** Formats the legend values and the hover titles. Put units here. */
    formatValue?: (v: number) => string
    /** Describe what the chart shows — this is the chart's accessible name. */
    ariaLabel?: string
}>(), {
    size: 168,
    thickness: 24,
    centerValue: undefined,
    centerLabel: undefined,
    formatValue: (v: number) => String(v),
    ariaLabel: undefined,
})

const total = computed(() => props.data.reduce((s, d) => s + d.value, 0) || 1)
const radius = computed(() => (props.size - props.thickness) / 2)
const circumference = computed(() => 2 * Math.PI * radius.value)

const label = computed(() => props.ariaLabel || 'Donut chart')

// Only --chart-1…5 exist, so the index wraps rather than resolving to a colour the
// theme never defined. A donut past five segments stops being readable — warn instead
// of silently drawing a sixth wedge in the first colour again.
const segmentColor = (d: DonutDatum, i: number) => d.color || `var(--chart-${(i % 5) + 1})`

if (import.meta.dev && props.data.length > 5) {
    console.warn(`[BsDonutChart] A donut reads best with at most 5 segments; got ${props.data.length}. Group the tail into an "Other" segment.`)
}

const segments = computed(() => {
    let acc = 0
    return props.data.map((d, i) => {
        const frac = d.value / total.value
        const offset = acc
        acc += frac
        return {
            key: d.label,
            datum: d,
            color: segmentColor(d, i),
            // The 2-unit shave is the reference's hairline gap between segments.
            dashArray: `${frac * circumference.value - 2} ${circumference.value - frac * circumference.value + 2}`,
            dashOffset: -offset * circumference.value,
            percent: Math.round(frac * 100),
        }
    })
})

const ringStyle = computed(() => ({
    '--bs-donut-size': `${props.size}px`,
    // Percentage, not px, so the centre overlay stays on the ring when the SVG scales.
    '--bs-donut-inset': `${(props.thickness / props.size) * 100}%`,
}))
</script>

<template>
    <div class="bs-donut">
        <div
            class="bs-donut__ring"
            :style="ringStyle"
        >
            <!-- role="img" sits on the SVG, not on the wrapper, so the centre value and
                 the legend stay reachable: together they already expose every number,
                 which is why this chart needs no hidden data table. -->
            <svg
                class="bs-donut__svg"
                role="img"
                :aria-label="label"
                width="100%"
                :viewBox="`0 0 ${size} ${size}`"
                preserveAspectRatio="xMidYMid meet"
            >
                <g :transform="`rotate(-90 ${size / 2} ${size / 2})`">
                    <circle
                        class="bs-donut__track"
                        :cx="size / 2"
                        :cy="size / 2"
                        :r="radius"
                        :stroke-width="thickness"
                    />
                    <circle
                        v-for="seg in segments"
                        :key="seg.key"
                        class="bs-donut__segment"
                        :cx="size / 2"
                        :cy="size / 2"
                        :r="radius"
                        :stroke-width="thickness"
                        :stroke-dasharray="seg.dashArray"
                        :stroke-dashoffset="seg.dashOffset"
                        :style="{ '--bs-donut-color': seg.color }"
                    ><title>{{ `${seg.datum.label}: ${formatValue(seg.datum.value)}` }}</title></circle>
                </g>
            </svg>
            <div class="bs-donut__center">
                <span class="bs-donut__value">
                    <slot name="centerValue">{{ centerValue }}</slot>
                </span>
                <span
                    v-if="centerLabel || $slots.centerLabel"
                    class="bs-caption"
                >
                    <slot name="centerLabel">{{ centerLabel }}</slot>
                </span>
            </div>
        </div>
        <ul class="bs-donut__legend">
            <li
                v-for="seg in segments"
                :key="seg.key"
                class="bs-donut__legend-item"
            >
                <span
                    aria-hidden="true"
                    class="bs-donut__swatch"
                    :style="{ '--bs-donut-color': seg.color }"
                />
                <span class="bs-donut__legend-label">{{ seg.datum.label }}</span>
                <span class="bs-mono bs-donut__legend-value">{{ formatValue(seg.datum.value) }} · {{ seg.percent }}%</span>
            </li>
        </ul>
    </div>
</template>
