import { clearNuxtData, useNuxtApp } from '#app'
import type { NuxtApp } from '#app'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { readBody, setResponseStatus } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { unref } from 'vue'
import EditUser from '~/pages/dashboard/users/[id].vue'
import Users from '~/pages/dashboard/users/index.vue'

const { session } = vi.hoisted(() => ({
    session: {
        user: { value: { id: 'session-admin', role: 'admin' } },
        loggedIn: { value: true },
        fetch: vi.fn(async () => {}),
        clear: vi.fn(async () => {}),
    },
}))
mockNuxtImport('useUserSession', () => () => session)

const fixtureUser = {
    id: 'fixture-user',
    email: 'fixture@example.com',
    name: 'Fixture user',
    role: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
}
const creates: Array<Record<string, unknown>> = []
const updates: Array<Record<string, unknown>> = []
let deletes = 0
let createFailure = ''
let saveFailure = ''
let deleteFailure = ''

// In-process test endpoints exercise real ofetch responses, without a DB or dev server.
registerEndpoint('/api/users', {
    method: 'GET',
    handler: () => ({ rows: [fixtureUser], total: 1, limit: 50, offset: 0 }),
})
registerEndpoint('/api/users/fixture-user', { method: 'GET', handler: () => fixtureUser })
registerEndpoint('/api/users', {
    method: 'POST',
    handler: async (event) => {
        creates.push(await readBody<Record<string, unknown>>(event))
        if (createFailure) {
            setResponseStatus(event, 409, 'Conflict')
            return { statusCode: 409, statusMessage: createFailure }
        }
        return fixtureUser
    },
})
registerEndpoint('/api/users/fixture-user', {
    method: 'PUT',
    handler: async (event) => {
        updates.push(await readBody<Record<string, unknown>>(event))
        if (saveFailure) {
            setResponseStatus(event, 400, 'Bad Request')
            return { statusCode: 400, statusMessage: saveFailure }
        }
        return fixtureUser
    },
})
registerEndpoint('/api/users/fixture-user', {
    method: 'DELETE',
    handler: (event) => {
        deletes++
        if (deleteFailure) {
            setResponseStatus(event, 403, 'Forbidden')
            return { statusCode: 403, statusMessage: deleteFailure }
        }
        return { ok: true }
    },
})

let wrapper: VueWrapper | undefined
let host: HTMLDivElement
let i18n: NuxtApp['$i18n']
let t: typeof i18n.t
let restoreLocale: () => Promise<void>

beforeEach(async () => {
    i18n = useNuxtApp().$i18n
    t = i18n.t
    creates.length = 0
    updates.length = 0
    deletes = 0
    createFailure = saveFailure = deleteFailure = ''
    clearNuxtData()
    const previousLocale = unref(i18n.locale)
    restoreLocale = () => i18n.setLocale(previousLocale)
    await i18n.setLocale('en')
    host = document.createElement('div')
    document.body.appendChild(host)
}, 30_000)

afterEach(async () => {
    wrapper?.unmount()
    wrapper = undefined
    host.remove()
    clearNuxtData()
    await restoreLocale()
}, 30_000)

async function createForm() {
    wrapper = await mountSuspended(Users, { attachTo: host, route: '/dashboard/users' })
    const open = wrapper.findAll('button').find((button) => button.text() === t('userAdmin.new'))
    expect(open).toBeDefined()
    await open!.trigger('click')
    await expect.poll(() => document.querySelector('[role="dialog"] form')).not.toBeNull()
    return new DOMWrapper(document.querySelector<HTMLFormElement>('[role="dialog"] form')!)
}

async function editForm() {
    wrapper = await mountSuspended(EditUser, {
        attachTo: host,
        route: '/dashboard/users/fixture-user',
    })
    return wrapper.get('form')
}

async function submit(form: Omit<DOMWrapper<Element>, 'exists'>) {
    await form.trigger('submit')
    await flushPromises()
}

async function fieldError(form: Omit<DOMWrapper<Element>, 'exists'>, selector: string, message: string) {
    expect(message).not.toMatch(/^userAdmin\./)
    const input = form.get(selector)
    // Assert the displayed error is connected to its input, not just somewhere on the page.
    await expect.poll(() => {
        const ids = input.attributes('aria-describedby')?.split(' ') ?? []
        return ids.map((id) => document.getElementById(id)?.textContent?.trim())
    }).toContain(message)
    expect(input.attributes('aria-invalid')).toBe('true')
}

describe('user-admin form validation', () => {
    it('shows eager localized errors, blocks invalid creation, and submits corrected input', async () => {
        await i18n.setLocale('nl')
        const form = await createForm()
        await form.get('input[type="email"]').setValue('not-an-email')
        await form.get('input[type="password"]').setValue('short')
        const dutchEmailError = t('userAdmin.validation.emailInvalid')
        await fieldError(form, 'input[type="email"]', dutchEmailError)
        await fieldError(form, 'input[type="password"]', t('userAdmin.validation.passwordErrors.minLength', { min: 12 }))
        await submit(form)
        expect(creates).toHaveLength(0)

        // Changing locale on the same mounted form must also update schema error messages.
        await i18n.setLocale('en')
        await submit(form)
        const englishEmailError = t('userAdmin.validation.emailInvalid')
        expect(englishEmailError).not.toBe(dutchEmailError)
        await fieldError(form, 'input[type="email"]', englishEmailError)
        expect(form.text()).not.toContain(dutchEmailError)
        expect(creates).toHaveLength(0)

        await form.get('input[type="email"]').setValue('created@example.com')
        await form.get('input[type="password"]').setValue('Password123!')
        await submit(form)
        await fieldError(form, 'input[type="password"]', t('userAdmin.validation.passwordErrors.common'))
        expect(creates).toHaveLength(0)

        await form.get('input[type="password"]').setValue('Mountain-Pine42!')
        await submit(form)
        await expect.poll(() => creates.length).toBe(1)
        await expect.poll(() => document.querySelector('[role="dialog"] form')).toBeNull()
    }, 30_000)

    it('shows the create API body explanation rather than the generic ofetch status', async () => {
        createFailure = 'Email already exists'
        const form = await createForm()
        await form.get('input[type="email"]').setValue('existing@example.com')
        await form.get('input[type="password"]').setValue('Mountain-Pine42!')
        await submit(form)
        await expect.poll(() => creates.length).toBe(1)
        await expect.poll(() => form.find('[role="alert"]').text()).toBe(createFailure)
        expect(form.get('[role="alert"]').text()).not.toContain('Conflict')
    }, 30_000)

    it('blocks invalid edits and omits a blank password when the corrected edit is saved', async () => {
        const form = await editForm()
        await form.get('input[type="email"]').setValue('bad address@example.com')
        await form.get('input[type="password"]').setValue('mountain-pine42!')
        await submit(form)
        await fieldError(form, 'input[type="email"]', t('userAdmin.validation.emailInvalid'))
        await fieldError(form, 'input[type="password"]', t('userAdmin.validation.passwordErrors.uppercase'))
        expect(updates).toHaveLength(0)

        await form.get('input[type="email"]').setValue('corrected@example.com')
        await form.get('input[type="password"]').setValue('')
        await submit(form)
        await expect.poll(() => updates.length).toBe(1)
        expect(updates[0]).not.toHaveProperty('password')
    }, 30_000)

    it('shows API body explanations for save and delete failures', async () => {
        saveFailure = 'Cannot remove the last admin'
        deleteFailure = 'Cannot delete yourself'
        const form = await editForm()
        await submit(form)
        await expect.poll(() => updates.length).toBe(1)
        await expect.poll(() => form.find('[role="alert"]').text()).toBe(saveFailure)
        expect(form.get('[role="alert"]').text()).not.toContain('Bad Request')

        const open = form.findAll('button').find((button) => button.text() === t('userAdmin.edit.delete'))
        expect(open).toBeDefined()
        await open!.trigger('click')
        await expect.poll(() => document.querySelector('[role="dialog"]')).not.toBeNull()
        const dialog = new DOMWrapper(document.querySelector<HTMLElement>('[role="dialog"]')!)
        const confirm = dialog.findAll('button').find((button) => button.text() === t('userAdmin.edit.deleteConfirmAction'))
        expect(confirm).toBeDefined()
        await confirm!.trigger('click')
        await expect.poll(() => deletes).toBe(1)
        await expect.poll(() => form.find('[role="alert"]').text()).toBe(deleteFailure)
        expect(form.get('[role="alert"]').text()).not.toContain('Forbidden')
    }, 30_000)
})
