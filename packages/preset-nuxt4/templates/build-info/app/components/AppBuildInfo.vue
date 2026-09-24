<template>
    <p class="text-xs text-muted">
        {{ t('build.version', { version: build.version }) }}
        <template v-if="build.shortCommit">
            <span aria-hidden="true"> · </span>
            <!-- `title` carries the full sha: seven characters identify a commit for a human,
                 but pasting them into a tool that wants all forty does not. -->
            <a
                v-if="build.commitUrl"
                :href="build.commitUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="font-mono hover:text-primary"
                :title="detail"
            >{{ build.shortCommit }}</a>
            <span v-else class="font-mono" :title="detail">{{ build.shortCommit }}</span>
        </template>
    </p>
</template>

<script setup lang="ts">
const { t } = useI18n()
const build = useBuildInfo()

// Built-at is deliberately not rendered inline: the footer answers "which code is this",
// and a second date on every page competes with that without answering anything else.
const detail = computed(() => {
    const parts = [t('build.commit', { commit: build.commit })]
    if (build.builtAt) parts.push(t('build.builtAt', { date: build.builtAt }))
    return parts.join(' — ')
})
</script>
