export interface UpdateReport {
    /** Files written or modified by this update. */
    written: string[]
    /** Files the user modified, left untouched. */
    skipped: string[]
    /** Free-form notes shown to the user. */
    notes: string[]
    /** Tracked files the user had deleted, restored by this pull. */
    restoredDeleted?: string[]
}
