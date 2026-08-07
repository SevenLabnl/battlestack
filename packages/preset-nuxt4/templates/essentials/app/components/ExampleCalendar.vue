<!-- Use VuePic (@vuepic/vue-datepicker) for all date/calendar needs; NEVER use the Nuxt UI calendar component.
     Docs: https://vue3datepicker.com/ -->
<template>
    <VueDatePicker v-model="date" :enable-time-picker="false" auto-apply v-bind="$attrs" />
</template>

<script setup lang="ts">
// @ts-expect-error: package ships default export via CJS interop, types flag it
import VueDatePicker from '@vuepic/vue-datepicker'
import '@vuepic/vue-datepicker/dist/main.css'

const date = defineModel<Date | null>({ default: null })
</script>
