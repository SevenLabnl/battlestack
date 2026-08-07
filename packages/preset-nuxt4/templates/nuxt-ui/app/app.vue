<template>
    <UApp>
        <NuxtLoadingIndicator />
        <NuxtLayout>
            <NuxtPage />
        </NuxtLayout>
    </UApp>
</template>

<script setup lang="ts">
const appName = (useRuntimeConfig().public.appName as string) || 'App'

// Pages set their own title via `useHead({ title })`/`useSeoMeta({ title })`, rendering "<page title> - <app name>"; pages
// with none fall back to the app name. Defined here (not nuxt.config) because config head is serialized and functions are stripped.
useHead({
    titleTemplate: (title) => (title ? `${title} - ${appName}` : appName),
})
</script>
