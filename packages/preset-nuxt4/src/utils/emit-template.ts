import {
    copyTemplateDirRecorded,
    templatesDir,
    updateFromTemplateDir,
    updateFromTemplateDirs,
    type InstalledFeatureRecord,
    type RunContext,
    type UpdateReport,
} from '@battlestack/core'

/** Template-emit helpers resolving `<caller-dir>/../../templates/<name>`. */
export function emitTemplate(
    ctx: RunContext,
    featureId: string,
    callerUrl: string,
    templateName: string,
): Promise<void> {
    return copyTemplateDirRecorded(ctx, featureId, templatesDir(callerUrl, '..', '..', 'templates', templateName))
}

export function emitTemplateUpdate(
    ctx: RunContext,
    featureId: string,
    callerUrl: string,
    templateName: string,
    prev: InstalledFeatureRecord | null,
): Promise<UpdateReport> {
    return updateFromTemplateDir(ctx, featureId, templatesDir(callerUrl, '..', '..', 'templates', templateName), prev)
}

/** Multi-subtree variant. `opts.keepRels` lists feature paths outside every subtree. */
export function emitTemplateUpdateMany(
    ctx: RunContext,
    featureId: string,
    callerUrl: string,
    templateNames: string[],
    prev: InstalledFeatureRecord | null,
    opts: { keepRels?: string[] } = {},
): Promise<UpdateReport> {
    const srcDirs = templateNames.map((name) => templatesDir(callerUrl, '..', '..', 'templates', name))
    return updateFromTemplateDirs(ctx, featureId, srcDirs, prev, opts.keepRels)
}
