# Design: AppShell + Kobalte ColorMode

**Date:** 2026-06-22
**Status:** Approved

## Scope

ColorMode setup (Kobalte) + AppShell layout shell. No features inside — just the frame.

## Decisions

- **ColorMode:** `@kobalte/core` ColorModeProvider + ColorModeScript, localStorage key `"sakti-theme"`, default dark
- **CSS tokens:** Keep existing shadcn-style oklch tokens in `index.css` as-is
- **Router:** Keep existing SolidJS Router structure
- **Layout:** Sidebar (left) + main area (toolbar + tabs + content), matching pibun's AppShell structure but using our token naming

## Components

| File | Purpose |
|------|---------|
| `components/AppShell.tsx` | Top-level flex layout: sidebar + main |
| `components/Sidebar.tsx` | Left panel (stub) |
| `components/Toolbar.tsx` | Top toolbar (stub) |
| `components/ContentTabBar.tsx` | Chat + terminal tab bar (stub) |

## Layout

```
+-----------+--------------------------------------+
| Sidebar   | Toolbar                              |
|           | ContentTabBar                        |
|           | Content area (relative, flex-1)       |
|           |   Chat layer (absolute inset-0)      |
|           |   Terminal layers (absolute, hidden)  |
+-----------+--------------------------------------+
```

## Files Modified

- `index.html` — add ColorModeScript
- `routes.tsx` — wrap with ColorModeProvider, render AppShell
- `pages/home.tsx` — replaced by AppShell routing
