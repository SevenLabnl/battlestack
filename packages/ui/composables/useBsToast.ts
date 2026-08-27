import { ref, type Ref } from 'vue'

/**
 * The toast queue behind `<BsToastStack>`.
 *
 * The export ships Toast and ToastStack as dumb components: the app is expected
 * to hold the list itself. This composable is that list, so any component can
 * confirm an action without owning state or reaching for a prop drill.
 *
 * Named `useBsToast` and not `useToast` on purpose: Nuxt UI registers a global
 * `useToast()` in these projects, and an auto-import collision between the two
 * would resolve silently to whichever layer won.
 *
 * A toast is a confirmation after the fact — "Record saved", "Invite sent" — and
 * it auto-dismisses. It is never the place for an error the user has to act on:
 * that is Alert (page-level state) or a ValidationMessage (a field).
 * See guidelines/ux-patterns.md, "Feedback".
 */

export type BsToastTone = 'info' | 'success' | 'warning' | 'danger'

export interface BsToastOptions {
    /** Tone pairs a tint with its own glyph; status is never colour alone. */
    tone?: BsToastTone
    title: string
    description?: string
    /** Milliseconds on screen. Defaults to BS_TOAST_DURATION. */
    duration?: number
}

export interface BsToastItem extends BsToastOptions {
    id: number
    tone: BsToastTone
}

/** Max toasts stacked at once; a fourth pushes the oldest out. */
export const BS_TOAST_LIMIT = 3

/** Default time on screen, in milliseconds. */
export const BS_TOAST_DURATION = 5000

// Module scope, not component scope: the queue has to be the same list for the
// component that pushes onto it and the single stack that renders it.
const queue = ref<BsToastItem[]>([])
let nextId = 0

function add(options: BsToastOptions): number {
    const id = ++nextId
    const item: BsToastItem = { tone: 'info', ...options, id }

    // Oldest out rather than newest refused: the toast a user just triggered is
    // the one they are looking for.
    queue.value = [...queue.value, item].slice(-BS_TOAST_LIMIT)

    return id
}

function dismiss(id: number): void {
    queue.value = queue.value.filter((item) => item.id !== id)
}

function clear(): void {
    queue.value = []
}

export function useBsToast() {
    return {
        /** The live queue, oldest first. Read-only for callers; use add/dismiss. */
        toasts: queue as Readonly<Ref<BsToastItem[]>>,
        /** Queue a toast; returns its id so it can be dismissed early. */
        add,
        dismiss,
        clear,
    }
}
