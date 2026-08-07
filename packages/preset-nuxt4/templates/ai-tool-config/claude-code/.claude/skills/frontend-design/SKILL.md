---
name: frontend-design
description: Design thinking for distinctive, production-grade UI. Uses Nuxt UI v4, Tailwind CSS v4, and the project's design system.
---

# Frontend Design

Use this skill when building new pages, redesigning existing UI, or making significant visual changes. The goal is distinctive, polished UI, not cookie-cutter defaults.

## Before Writing Code

### 1. Define the Design Intent
Answer these questions before touching any template code:
- **Purpose**: What does this page/component accomplish?
- **Audience**: Who uses it? (admin, end user, developer)
- **Tone**: Professional, playful, minimal, data-dense?
- **Constraints**: Mobile-only? Dashboard? Public-facing?

### 2. Audit the Existing Design System
Check these files before making design decisions:
- `app.config.ts`: project color scheme and theme tokens
- `app/assets/css/main.css`: Tailwind CSS v4 design tokens and custom properties
- `app/components/`: existing component patterns
- `nuxt.config.ts`: active Nuxt UI configuration

### 3. Choose a Direction
Based on the intent, decide on:
- **Color palette**: Use project tokens from `app.config.ts`, extend only if needed
- **Typography**: Font weights, sizes, line heights from Tailwind scale
- **Spacing**: Consistent use of Tailwind spacing scale (4, 8, 12, 16, 24, 32, 48)
- **Motion**: Subtle transitions (150-300ms) for interactive elements

## Component Selection

### Use Nuxt UI v4 Components First
Before building custom components, check if Nuxt UI v4 has what you need:

| Need | Component |
|---|---|
| Buttons | `UButton` with variants (solid, outline, ghost, soft, subtle, link) |
| Forms | `UForm`, `UFormField`, `UInput`, `USelect`, `UTextarea`, `UCheckbox` |
| Feedback | `UToast`, `UAlert`, `UBadge`, `UChip` |
| Navigation | `UNavigationMenu`, `UTabs`, `UBreadcrumb`, `UPagination` |
| Overlays | `UModal`, `UDrawer`, `UPopover`, `UTooltip`, `UDropdownMenu` |
| Data | `UTable`, `UAccordion`, `UCard` |
| Layout | `UContainer`, `UDashboardLayout`, `UDashboardPanel` |
| Media | `UAvatar`, `UCarousel`, `UIcon` |

### Customization via Tailwind Variants
Use `class` and `ui` props for customization. Prefer Tailwind classes over inline styles.

```vue
<UButton
  color="primary"
  variant="solid"
  size="lg"
  class="font-semibold tracking-wide"
/>
```

## Layout Patterns

### Responsive-First (Mobile-First)
Always start with mobile layout, then add breakpoints:
```html
<div class="px-4 sm:px-6 md:px-8 lg:px-12">
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
    <!-- content -->
  </div>
</div>
```

### Dashboard Layout
Use Nuxt UI's dashboard components for admin interfaces:
```vue
<UDashboardLayout>
  <UDashboardPanel>
    <!-- sidebar -->
  </UDashboardPanel>
  <UDashboardPanel grow>
    <!-- main content -->
  </UDashboardPanel>
</UDashboardLayout>
```

### PWA Considerations
- Touch targets: minimum 44x44px for interactive elements
- Safe areas: `env(safe-area-inset-*)` for notched devices
- Standalone mode: no browser chrome, design accordingly

## Visual Quality Checklist

Before completing UI work:
- [ ] Colors match project design tokens from `app.config.ts`
- [ ] Typography is consistent (use Tailwind text-* scale)
- [ ] Spacing follows the project's spacing scale
- [ ] Interactive elements have hover/focus/active states
- [ ] Loading states for async operations (skeleton, spinner)
- [ ] Empty states for lists and tables
- [ ] Error states for forms and API failures
- [ ] Responsive: tested at 375px (mobile), 768px (tablet), 1280px (desktop)
- [ ] Dark mode support (if enabled in project)
- [ ] i18n: all visible text uses translation keys

## Animation Guidelines
- **Page transitions**: 200ms ease-in-out
- **Hover effects**: 150ms ease
- **Modal/drawer**: 200-300ms with backdrop fade
- **Skeleton loading**: pulse animation via Tailwind `animate-pulse`
- **Do not animate**: layout shifts, large content reflows

## Rules
- Never use raw hex colors; use theme tokens or Tailwind color classes
- Never build a custom component when Nuxt UI v4 has an equivalent
- Always test at mobile width first
- Always include loading and empty states
- Use semantic HTML elements (`<nav>`, `<main>`, `<section>`, `<article>`)
