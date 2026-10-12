import { clearNuxtData, useNuxtApp, useRuntimeConfig } from '#app'
import type { NuxtApp } from '#app'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import type { DOMWrapper, VueWrapper } from '@vue/test-utils'
import { readBody, setResponseStatus } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { unref } from 'vue'
import Signup from '~/pages/signup.vue'

const { session } = vi.hoisted(() => ({
    session: {
        user: { value: null },
        loggedIn: { value: true },
        fetch: vi.fn(async () => {}),
        clear: vi.fn(async () => {}),
    },
}))
mockNuxtImport('useUserSession', () => () => session)

const requests: Array<Record<string, unknown>> = []
let apiFailure = ''
// Keep the actual useAuth/$fetch path, including body parsing and ofetch error construction.
registerEndpoint('/api/auth/signup', {
    method: 'POST',
    handler: async (event) => {
        requests.push(await readBody<Record<string, unknown>>(event))
        if (apiFailure) {
            setResponseStatus(event, 400, 'Bad Request')
            return { statusCode: 400, statusMessage: apiFailure }
        }
        return { ok: true }
    },
})

let i18n: NuxtApp['$i18n']
let t: typeof i18n.t
let restoreConfig: () => Promise<void>
let wrapper: VueWrapper | undefined
let host: HTMLDivElement

beforeEach(async () => {
    i18n = useNuxtApp().$i18n
    t = i18n.t
    const config = useRuntimeConfig()
    requests.length = 0
    apiFailure = ''
    session.fetch.mockClear()
    clearNuxtData()
    const previousLocale = unref(i18n.locale)
    const previousRegistration = config.public.allowRegistration
    restoreConfig = async () => {
        config.public.allowRegistration = previousRegistration
        await i18n.setLocale(previousLocale)
    }
    config.public.allowRegistration = true
    await i18n.setLocale('nl')
    host = document.createElement('div')
    document.body.appendChild(host)
}, 30_000)

afterEach(async () => {
    wrapper?.unmount()
    wrapper = undefined
    host.remove()
    clearNuxtData()
    await restoreConfig()
}, 30_000)

async function signupForm() {
    wrapper = await mountSuspended(Signup, { attachTo: host, route: '/signup' })
    return wrapper.get('form')
}

async function submit(form: Omit<DOMWrapper<Element>, 'exists'>) {
    await form.trigger('submit')
    await flushPromises()
}

async function fieldError(form: Omit<DOMWrapper<Element>, 'exists'>, selector: string, message: string) {
    expect(message).not.toMatch(/^auth\./)
    const input = form.get(selector)
    await expect.poll(() => {
        const ids = input.attributes('aria-describedby')?.split(' ') ?? []
        return ids.map((id) => document.getElementById(id)?.textContent?.trim())
    }).toContain(message)
    expect(input.attributes('aria-invalid')).toBe('true')
}

describe('signup form validation', () => {
    it('blocks invalid email and shared-policy passwords, then submits corrected input', async () => {
        const form = await signupForm()
        await form.get('input[type="email"]').setValue('not-an-email')
        await form.get('input[type="password"]').setValue('short')
        await fieldError(form, 'input[type="email"]', t('auth.signup.validation.email'))
        await fieldError(form, 'input[type="password"]', t('auth.signup.validation.minLength', { min: 12 }))
        await submit(form)
        expect(requests).toHaveLength(0)

        await form.get('input[type="email"]').setValue('signup@example.com')
        await form.get('input[type="password"]').setValue('mountain-pine42!')
        await submit(form)
        const dutchUppercaseError = t('auth.signup.validation.uppercase')
        await fieldError(form, 'input[type="password"]', dutchUppercaseError)
        expect(requests).toHaveLength(0)

        // Locale changes must update the schema as well as labels/help text.
        await i18n.setLocale('en')
        await submit(form)
        const englishUppercaseError = t('auth.signup.validation.uppercase')
        expect(englishUppercaseError).not.toBe(dutchUppercaseError)
        await fieldError(form, 'input[type="password"]', englishUppercaseError)
        expect(form.text()).not.toContain(dutchUppercaseError)
        expect(requests).toHaveLength(0)

        await form.get('input[type="password"]').setValue('Password123!')
        await submit(form)
        await fieldError(form, 'input[type="password"]', t('auth.signup.validation.common'))
        expect(requests).toHaveLength(0)

        await form.get('input[type="password"]').setValue('Mountain-Pine42!')
        await submit(form)
        await expect.poll(() => requests.length).toBe(1)
        await expect.poll(() => wrapper!.text()).toContain(t('auth.signup.success.title'))
        expect(wrapper!.find('form').exists()).toBe(false)
    }, 30_000)

    it('shows the signup API body explanation and leaves the form available to correct', async () => {
        await i18n.setLocale('en')
        apiFailure = 'Password is too common'
        const form = await signupForm()
        await form.get('input[type="email"]').setValue('signup@example.com')
        await form.get('input[type="password"]').setValue('Mountain-Pine42!')
        await submit(form)
        await expect.poll(() => requests.length).toBe(1)
        await expect.poll(() => form.text()).toContain(apiFailure)
        expect(form.text()).not.toContain('Bad Request')
        expect(wrapper!.find('form').exists()).toBe(true)

        apiFailure = ''
        await submit(form)
        await expect.poll(() => requests.length).toBe(2)
        await expect.poll(() => wrapper!.text()).toContain(t('auth.signup.success.title'))
    }, 30_000)
})
