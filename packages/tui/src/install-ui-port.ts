import { setUiPort } from '@battlestack/core'
import * as ui from './ui.js'

/** Wires this package's `ui.ts` into core's `UiPort` seam. Hosts call this at startup. */
export function installUiPort(): void {
    setUiPort({
        debug: ui.debug,
        warn: ui.warn,
        dim: ui.dim,
        blank: ui.blank,
        bullet: ui.bullet,
        sym: ui.sym,
        color: { dim: ui.color.dim },
        withSpinnerPaused: ui.withSpinnerPaused,
        setActiveSpinner: ui.setActiveSpinner,
    })
}
