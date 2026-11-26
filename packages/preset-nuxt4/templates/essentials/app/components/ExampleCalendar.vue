<!-- Use VuePic (@vuepic/vue-datepicker) for all date/calendar needs; NEVER use the Nuxt UI calendar component.
     Docs: https://vue3datepicker.com/ -->
<template>
    <VueDatePicker
        v-model="date"
        :time-config="{ enableTimePicker: false }"
        auto-apply
        v-bind="$attrs"
    />
</template>

<script setup lang="ts">
import { VueDatePicker } from '@vuepic/vue-datepicker'
import '@vuepic/vue-datepicker/dist/main.css'

const date = defineModel<Date | null>({ default: null })
</script>
