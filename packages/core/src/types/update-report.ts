export interface UpdateReport {
    /** Files written or modified by this update. */
    written: string[]
    /** Files the user modified, left untouched. */
    skipped: string[]
    /** Free-form notes shown to the user. */
    notes: string[]
    /** Tracked files the user had deleted, restored by this pull. */
    restoredDeleted?: string[]
    /** Edited files merged three-way without conflicts. */
    merged?: string[]
    /** Edited files merged three-way, left with conflict markers to resolve. */
    conflicts?: string[]
    /** Backups of regenerated files that had local edits, relative to the project. */
    backups?: string[]
    /** Files no longer shipped, left in place unrecorded because they have local edits. */
    unmanaged?: string[]
    /** Steps a person has to take that the update could not, e.g. in GitHub settings. */
    actions?: string[]
}
