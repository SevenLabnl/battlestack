/** How `version` relates to the version at the base ref, before looking at changed files. */
export function versionStatus(base: string | null, version: string): 'new' | 'bumped' | 'lowered' | 'same' {
    if (base === null) return 'new'
    const a = version.split('.').map(Number)
    const b = base.split('.').map(Number)
    for (let i = 0; i < 3; i++) {
        if (a[i]! > b[i]!) return 'bumped'
        if (a[i]! < b[i]!) return 'lowered'
    }
    return 'same'
}
