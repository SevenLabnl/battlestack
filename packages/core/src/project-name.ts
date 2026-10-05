import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import type { ProjectManifest } from './types/project-manifest.js'

/** True when `dir` sits inside a linked git worktree (`git worktree add`), not the main checkout. */
export function isLinkedWorktree(dir: string): boolean {
    let current = path.resolve(dir)
    while (true) {
        const dotGit = path.join(current, '.git')
        const stat = statSync(dotGit, { throwIfNoEntry: false })
        if (stat?.isDirectory()) return false
        if (stat?.isFile()) {
            const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'))
            if (!match) return false
            const gitDir = path.resolve(current, match[1].trim())
            return statSync(path.join(gitDir, 'commondir'), { throwIfNoEntry: false })?.isFile() ?? false
        }
        const parent = path.dirname(current)
        if (parent === current) return false
        current = parent
    }
}

/** The project's name: the directory name, except in a linked worktree, where the recorded name wins. */
export function resolveProjectName(projectDir: string, manifest?: Pick<ProjectManifest, 'projectName'> | null): string {
    const recorded = manifest?.projectName
    if (recorded && isLinkedWorktree(projectDir)) return recorded
    return path.basename(projectDir)
}
