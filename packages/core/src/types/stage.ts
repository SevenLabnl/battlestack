import type { STAGE_ORDER } from '../constants/stages.js'

export type Stage = (typeof STAGE_ORDER)[number]
