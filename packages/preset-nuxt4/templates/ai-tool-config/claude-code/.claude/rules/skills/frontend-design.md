# Frontend Design

When building or redesigning UI:

## Before Code
1. Define intent: purpose, audience, tone, constraints
2. Audit design system: `app.config.ts` (colors), `main.css` (tokens), existing components
3. Choose direction: color palette from tokens, typography from Tailwind scale, consistent spacing

## Component Selection
Use Nuxt UI v4 first: `UButton`, `UForm`, `UTable`, `UModal`, `UDrawer`, `UCard`, `UToast`, `UDashboardLayout`, `UNavigationMenu`, `UTabs`, `UBreadcrumb`, `UAvatar`. Customize via `class` and `ui` props with Tailwind classes.

## Layout
- Mobile-first: start with base, add `sm:`, `md:`, `lg:` breakpoints
- Dashboard: use `UDashboardLayout` + `UDashboardPanel`
- PWA: 44x44px touch targets, `env(safe-area-inset-*)`, standalone mode

## Animation
- Page transitions: 200ms ease-in-out
- Hover: 150ms ease
- Modals: 200-300ms with backdrop
- Loading: `animate-pulse` skeletons

## Checklist
- Colors match `app.config.ts` tokens
- Consistent typography and spacing
- Hover/focus/active states on interactive elements
- Loading, empty, and error states
- Responsive at 375px, 768px, 1280px
- i18n: all text uses translation keys

Never use raw hex colors. Never build custom when Nuxt UI v4 has an equivalent. Always test mobile first. Always include loading and empty states.
