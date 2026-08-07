// Coarse execution buckets. Use `before`/`after` for fine ordering within a stage.
export const STAGE_ORDER = [
    'SCAFFOLD',
    'GITIGNORE',
    'NAMING',
    'BASE_CONFIG',
    'STYLING',
    'I18N',
    'DATABASE',
    'AUTH',
    'AUTH_EXTRAS',
    'STORAGE',
    'AI_CORE',
    'CHAT',
    'RAG',
    'MASTRA',
    'PWA',
    'ICONS',
    'AI_TOOL_CONFIG',
    'DOCS',
    'ENV',
    'FINALIZE',
] as const

export const STAGE = Object.fromEntries(STAGE_ORDER.map((s) => [s, s])) as {
    [K in (typeof STAGE_ORDER)[number]]: K
}
