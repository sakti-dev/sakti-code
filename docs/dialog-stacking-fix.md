# Dialog Stacking: Why Non-Kobalte Dialogs Break on Top of Kobalte Modals

## Context

The app has two kinds of dialogs:

1. **Kobalte dialogs** (`DialogContent` from `~/components/ui/dialog`) — used by
   the settings dialog. These participate in Kobalte's `DismissableLayer` /
   `layer-stack` system, which manages focus trapping, outside-click dismissal,
   and `pointer-events` on `document.body`.

2. **Raw `<Portal>` dialogs** — used by the model selector
   (`models-settings.tsx`). These portal to `document.body` with manual
   `data-stack-content` / `data-stack-overlay` attributes but do **not** use
   `DialogContent`, `DismissableLayer`, or any Kobalte layer registration.

The `dismissible-stack.ts` module hides the lower dialog (content + overlay +
portal wrapper) when a second dialog opens on top, preventing doubled backdrops.

## The Three Bugs

When the model selector (raw `<Portal>`) opened on top of the settings dialog
(Kobalte modal), three separate bugs combined to make the model selector
unclickable and caused it to close on any internal click.

### Bug 1: DOM-order stack tracking was unreliable

**Symptom:** The wrong dialog was sometimes identified as "topmost."

**Cause:** `recomputeDialogStack` used `document.querySelectorAll` to determine
stack order — last `[data-stack-content]` in the DOM wins. But SolidJS/Kobalte
can re-portal elements during re-render, shifting DOM order independently of
open order.

**Fix:** Maintain an explicit `stackIds: string[]` array. New IDs are pushed to
the end (topmost); removed IDs are pruned. The array preserves first-seen order,
immune to DOM re-ordering.

### Bug 2: Non-Kobalte dialogs inherited `pointer-events: none` from body

**Symptom:** The model selector was visible but completely unclickable — no
hover effects, no clicks registered.

**Cause:** Kobalte's modal `DialogContent` calls
`layerStack.disableBodyPointerEvents()`, which sets:

```js
document.body.style.pointerEvents = "none";
```

Kobalte then gives its own layer nodes `pointer-events: auto` via
`assignPointerEventToLayers()` (inline style on each registered node). But the
model selector uses raw `<Portal>` — it is **not** a Kobalte layer node, so it
never gets `pointer-events: auto`. It inherits `none` from `body`.

**Fix:** In `setPortalWrapperHidden`, when a dialog is the topmost (visible),
set inline `style.pointerEvents = "auto"` on its portal wrapper. This overrides
the inherited `none` from body. The portal wrapper is the direct child of
`document.body` that contains the dialog's overlay + content.

### Bug 3: Kobalte's outside-click detection dismissed the lower dialog

**Symptom:** Clicking **inside** the model selector closed both dialogs
simultaneously.

**Cause:** Kobalte's `createInteractOutside` (used by `DismissableLayer`) listens
for `pointerdown` on `document` in capture phase. When a `pointerdown` fires, it
checks:

```js
// create-interact-outside.ts, isEventOutside()
if (target.closest(`[data-kb-top-layer]`)) {
    return false; // NOT outside — ignore
}
if (contains(ref(), target)) {
    return false; // inside this dialog — ignore
}
return !props.shouldExcludeElement?.(target); // otherwise: it's "outside"
```

The settings dialog's content `ref` does **not** contain the model selector (they
are separate portals on `body`). The model selector has no `data-kb-top-layer`
attribute (only Kobalte toasts set that normally). So every click inside the
model selector was classified as an "outside" click on the settings dialog.

Since the settings dialog was the only Kobalte layer (model selector isn't
registered), `isTopMostLayer()` returned `true`, and `onDismiss()` →
`context.close()` fired — closing the settings dialog and cascading the model
selector unmount with it.

**Fix:** In `setPortalWrapperHidden`, when a dialog is topmost, set
`data-kb-top-layer=""` on its portal wrapper. Kobalte's `createInteractOutside`
checks `target.closest('[data-kb-top-layer]')` and skips the outside-click logic
for any click inside such an element.

## Summary of fixes in `setPortalWrapperHidden`

| State | `pointer-events` | `data-kb-top-layer` | Why |
|-------|-----------------|--------------------|----|
| **Hidden** (lower dialog) | `none` (class) + clear inline | removed | Prevent interaction; allow clicks to pass through |
| **Visible** (topmost) | `auto` (inline) | set | Override body's `none`; tell Kobalte to ignore outside-click |

## Known limitation

When the model selector closes, Kobalte's `createHideOutside` (from the settings
dialog) applies `aria-hidden="true"` to the model selector's portal wrapper while
its input may still have focus, producing a browser accessibility warning:

```
Blocked aria-hidden on an element because its descendant retained focus.
```

This is transient — Kobalte's `onCloseAutoFocus` moves focus back to the trigger
shortly after. The proper long-term fix is to make the model selector use
`DialogContent` so it participates in Kobalte's layer system natively.
