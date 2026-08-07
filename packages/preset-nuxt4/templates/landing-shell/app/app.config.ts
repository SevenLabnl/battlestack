export default defineAppConfig({
    ui: {
        colors: {
            primary: 'blue',
            secondary: 'purple',
            neutral: 'zinc',
        },
    },
    // Deliberately empty: entries that depend on a feature (Dashboard, Chat, Admin group) are added by the layout, gated on
    // `runtimeConfig.public` flags the providing feature sets; a static entry here would advertise a route that may not exist.
    nav: [],
    topbar: [],
})
