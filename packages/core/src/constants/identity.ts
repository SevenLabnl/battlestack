/** Single source of truth for what this CLI calls itself. */
export const CURRENT_NAME = 'battlestack'

/** Every name this product answered to before `CURRENT_NAME`, oldest first. Append-only. */
export const PRIOR_NAMES: readonly string[] = []

/** `CURRENT_NAME` first (checked/preferred by default), then every prior name. */
export const ALL_NAMES: readonly string[] = [CURRENT_NAME, ...PRIOR_NAMES]
