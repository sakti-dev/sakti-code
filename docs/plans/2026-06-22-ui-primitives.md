# UI Primitives Plan

## Context

The Sakti frontend has a complete store layer (13 test files, 98+124 tests), CSS theme system (OKLCH tokens, light/dark, Kobalte ColorMode), and layout skeletons — but zero functional UI components. Everything downstream (sidebar, chat, toolbar, settings) needs these primitives as building blocks.

**Dependencies already installed:** `@kobalte/core` (headless UI), `class-variance-authority` (variant engine), `clsx` + `tailwind-merge` (via `cn()`), `tailwindcss-animate`.

**Code style:** All lowercase kebab-case filenames. Tailwind utility classes only. `cn()` for class merging. SolidJS `class` attribute (not `className`). No comments unless asked.

---

## Components (8 files)

### 1. `apps/app/src/components/ui/button.tsx`
- CVA variants: `default`, `secondary`, `destructive`, `ghost`, `outline`
- Sizes: `sm`, `md`, `lg`, `icon`
- Props: `variant`, `size`, `disabled`, `loading` (shows spinner), `class`, children
- Renders `<button>` with `type="button"` default
- Loading state: opacity-50 + pointer-events-none + SVG spinner

### 2. `apps/app/src/components/ui/badge.tsx`
- CVA variants: `default`, `secondary`, `destructive`, `outline`, `success`, `warning`, `info`
- Size: `sm` (default), `md`
- Renders `<span>` with inline-flex + rounded-full + px-2.5 py-0.5 + text-xs

### 3. `apps/app/src/components/ui/tooltip.tsx`
- Thin wrapper around Kobalte `Tooltip.Root` / `Trigger` / `Content` / `Arrow`
- Props: `content` (string or JSX), `side` (top/right/bottom/left), `delayDuration` (default 300)
- Styled content: bg-popover text-popover-foreground border border-border rounded-md px-3 py-1.5 text-xs shadow-md
- Arrow: fill-popover stroke-border

### 4. `apps/app/src/components/ui/scroll-area.tsx`
- Native overflow container with styled `::-webkit-scrollbar` pseudo-elements
- Props: `vertical` (default true), `horizontal`, `class`, children
- Scrollbar styling: 6px width, transparent track, rounded thumb with hover/active states
- Uses CSS variables from theme for thumb color

### 5. `apps/app/src/components/ui/separator.tsx`
- Props: `orientation` (horizontal/vertical), `class`
- Horizontal: `h-px w-full bg-border`
- Vertical: `w-px h-full bg-border`

### 6. `apps/app/src/components/ui/dropdown-menu.tsx`
- Kobalte `DropdownMenu.Root` / `Trigger` / `Content` / `Item` / `Separator` / `Label` wrapper
- Trigger: renders as child (Kobalte pattern)
- Content: styled popover with bg-popover border rounded-lg shadow-lg py-1, with `animate-in fade-in zoom-in-95` enter animation
- Item: flex items-center gap-2 px-3 py-1.5 text-sm rounded-sm cursor-pointer hover:bg-accent hover:text-accent-foreground outline-none transition-colors
- Optional `shortcut` prop rendered right-aligned in muted text
- Separator: `<DropdownMenu.Separator class="my-1 h-px bg-border" />`

### 7. `apps/app/src/components/ui/dialog.tsx`
- Kobalte `Dialog.Root` / `Trigger` / `Portal` / `Overlay` / `Content` / `Title` / `Description` / `CloseButton`
- Overlay: fixed inset-0 z-50 bg-black/60 backdrop-blur-sm
- Content: fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl p-6
- Enter animation: `animate-in fade-in zoom-in-95`
- Close button: top-right corner, ghost button
- Exports sub-components: `DialogTrigger`, `DialogContent`, `DialogTitle`, `DialogDescription`, `DialogClose`

### 8. `apps/app/src/components/ui/popover.tsx`
- Kobalte `Popover.Root` / `Trigger` / `Content` / `Arrow` wrapper
- Trigger: renders as child
- Content: absolute z-50 bg-popover border border-border rounded-lg shadow-lg p-4 with enter animation
- Arrow: fill-popover stroke-border

---

## Testing

Each component gets a basic render test in `apps/app/src/components/ui/__tests__/`:

| File | Tests |
|------|-------|
| `button.test.tsx` | renders with default variant, applies variant classes, applies size classes, shows loading spinner when loading, respects disabled |
| `badge.test.tsx` | renders with default variant, applies variant classes |
| `tooltip.test.tsx` | renders trigger, shows content on hover (requires pointer events) |
| `scroll-area.test.tsx` | renders children, applies vertical/horizontal classes |
| `separator.test.tsx` | renders horizontal by default, renders vertical when specified |
| `dropdown-menu.test.tsx` | renders trigger, opens on click, shows items |
| `dialog.test.tsx` | renders trigger, opens on click, shows content |
| `popover.test.tsx` | renders trigger, opens on click |

**Test infrastructure:** `vitest` + `@solidjs/testing-library` + `jsdom`. Follow existing test patterns from `apps/app/src/stores/__tests__/`.

---

## File Structure

```
apps/app/src/components/ui/
├── button.tsx
├── badge.tsx
├── tooltip.tsx
├── scroll-area.tsx
├── separator.tsx
├── dropdown-menu.tsx
├── dialog.tsx
├── popover.tsx
└── __tests__/
    ├── button.test.tsx
    ├── badge.test.tsx
    ├── tooltip.test.tsx
    ├── scroll-area.test.tsx
    ├── separator.test.tsx
    ├── dropdown-menu.test.tsx
    ├── dialog.test.tsx
    └── popover.test.tsx
```

---

## Verification

1. `bun typecheck` — clean
2. `cd apps/app && npx vitest run` — all tests pass (existing 98 + new)
3. `bun x ultracite fix` — clean
