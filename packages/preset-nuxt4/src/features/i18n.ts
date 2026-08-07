import { STAGE, isFeatureEnabled, type Feature } from '@battlestack/core'
import { templatesDir, updateFromTemplateDirs } from '@battlestack/core/utils/templates.js'
import { emitTemplate } from '../utils/emit-template.js'
import { patchNuxtConfig } from '../utils/nuxt-config.js'

/** @nuxtjs/i18n with per-locale namespace JSONs under `i18n/locales/<lang>/<ns>.json`. */
export const i18nFeature: Feature = {
    id: 'nuxt4:i18n',
    version: '1.1.0',
    label: 'i18n (Dutch + English)',
    frameworks: ['nuxt4'],
    stage: STAGE.I18N,

    collectModules() {
        return ['@nuxtjs/i18n']
    },

    async execute(ctx) {
        await emitTemplate(ctx, 'nuxt4:i18n', import.meta.url, 'i18n')
        if (isFeatureEnabled(ctx, 'nuxt4:auth')) {
            await emitTemplate(ctx, 'nuxt4:i18n', import.meta.url, 'i18n-auth')
        }
        await registerI18nConfig(ctx.projectDir)
    },

    async update(ctx, prev) {
        const subtrees = isFeatureEnabled(ctx, 'nuxt4:auth')
            ? ['i18n', 'i18n-auth']
            : ['i18n']
        // Two levels up, mirroring ../utils/emit-template.js.
        const srcDirs = subtrees.map((name) =>
            templatesDir(import.meta.url, '..', '..', 'templates', name),
        )
        const report = await updateFromTemplateDirs(ctx, 'nuxt4:i18n', srcDirs, prev)
        await registerI18nConfig(ctx.projectDir)
        return report
    },
}

/** Wires @nuxtjs/i18n into nuxt.config. Idempotent. */
async function registerI18nConfig(projectDir: string): Promise<void> {
    await patchNuxtConfig(projectDir, (c) => {
        c.mutate((config) => {
            config.i18n ||= {}
            config.i18n.defaultLocale = 'nl'
            config.i18n.strategy = 'no_prefix'
            // langDir is left unset, which skips the per-locale `file`/`files` checks.
            config.i18n.detectBrowserLanguage = {
                useCookie: true,
                cookieKey: 'i18n_locale',
                redirectOn: 'root',
                fallbackLocale: 'en',
            }
            config.i18n.locales ||= []
            const locales = config.i18n.locales as Array<Record<string, unknown>>
            for (const { code, language } of [
                { code: 'en', language: 'en-US' },
                { code: 'nl', language: 'nl-NL' },
            ]) {
                const entry = locales.find((l) => l.code === code)
                if (!entry) {
                    // The complete object is pushed at once: magicast snapshots plain objects.
                    locales.push({ code, language })
                    continue
                }
                entry.language = language
                if ('file' in entry) delete entry.file
                if ('files' in entry) delete entry.files
            }
            if ('langDir' in config.i18n) delete config.i18n.langDir
        })
    })
}
