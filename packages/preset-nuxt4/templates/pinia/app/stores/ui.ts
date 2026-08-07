import { defineStore } from 'pinia'

export const useUiStore = defineStore('ui', {
    state: () => ({
        sidebarCollapsed: false as boolean,
        theme: null as 'light' | 'dark' | null,
    }),
    actions: {
        toggleSidebar() {
            this.sidebarCollapsed = !this.sidebarCollapsed
        },
        setTheme(theme: 'light' | 'dark' | null) {
            this.theme = theme
        },
    },
    persist: true,
})
