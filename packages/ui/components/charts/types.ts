/**
 * The item shapes the three charts take.
 *
 * They used to be declared inside each `<script setup>`, where a consumer cannot reach
 * them — findings #12. Same shapes, same names, same doc comments; only the file moved,
 * so no prop type and no runtime behaviour changes with it.
 *
 * A colour is always a `--chart-*` token: a chart never introduces a colour of its own.
 */

/** One bar of a BarChart. */
export interface BarDatum {
    label: string
    value: number
    /** Per-bar override. Pass a --chart-* token; a chart never introduces its own colour. */
    color?: string
}

/** One line of a LineChart, plotted against the chart's shared `labels`. */
export interface LineSeries {
    name?: string
    points: number[]
    /** Per-series override. Pass a --chart-* token; a chart never introduces its own colour. */
    color?: string
    /** Render as a dashed reference line — forecast or target. Skips the area fill and the dots. */
    dashed?: boolean
}

/** One segment of a DonutChart. */
export interface DonutDatum {
    label: string
    value: number
    /** Per-segment override. Pass a --chart-* token; a chart never introduces its own colour. */
    color?: string
}
