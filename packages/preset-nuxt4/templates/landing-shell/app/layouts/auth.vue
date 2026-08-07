<template>
    <div
        class="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-default via-elevated to-accented dark:from-gray-950 dark:via-gray-900 dark:to-gray-800"
    >
        <div class="w-full max-w-4xl">
            <UCard
                class="overflow-hidden shadow-xl ring-1 ring-default"
                :ui="{ body: 'p-0 sm:p-0' }"
            >
                <div class="grid grid-cols-1 md:grid-cols-2">
                    <div class="flex flex-col justify-center p-6 sm:p-10">
                        <slot />
                    </div>
                    <div class="hidden md:block">
                        <img
                            src="/img/auth-cover.svg"
                            alt=""
                            class="h-full w-full object-cover"
                            aria-hidden="true"
                        />
                    </div>
                </div>
            </UCard>
        </div>
    </div>
</template>
