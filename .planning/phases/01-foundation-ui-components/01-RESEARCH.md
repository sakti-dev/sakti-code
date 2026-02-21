# Phase 1: Foundation & UI Components - Research

**Researched:** 2026-02-22
**Domain:** SolidJS UI Components / @kobalte/core
**Confidence:** HIGH

## Summary

This phase involves building atomic UI components (Select dropdown, Toggle switch, SettingsRow, SettingsSection) and a SettingsDialog with two-column layout. The project uses @kobalte/core ^0.13.11 as the primary UI library with Tailwind CSS for styling.

**Primary recommendation:** Create wrapper components around @kobalte/core primitives (Select, Switch) with ekacode-specific dark theme styling. Use the existing Dialog component pattern from `components/ui/dialog.tsx` and follow the two-column grid pattern from `provider-settings.tsx` line 919 (`md:grid-cols-[1.1fr_1.4fr]`).

## Standard Stack

### Core Libraries

| Library              | Version    | Purpose                 | Why Standard                                      |
| -------------------- | ---------- | ----------------------- | ------------------------------------------------- |
| @kobalte/core        | ^0.13.11   | UI component primitives | Already in use; accessible, composable primitives |
| solid-js             | catalog:   | Reactive framework      | Core framework                                    |
| tailwindcss          | catalog:   | Styling                 | Already configured                                |
| @kobalte/core/select | (included) | Select/dropdown         | For UI-01                                         |
| @kobalte/core/switch | (included) | Toggle switch           | For UI-02                                         |
| @kobalte/core/dialog | (included) | Dialog wrapper          | Already exists in codebase                        |

### Supporting

| Library                    | Version    | Purpose                          | When to Use                      |
| -------------------------- | ---------- | -------------------------------- | -------------------------------- |
| @kobalte/core/polymorphic  | (included) | Type-safe polymorphic components | Used in all wrapper components   |
| @solid-primitives/presence | ^0.1.2     | Presence animation               | For dialog open/close animations |
| lucide-solid               | ^0.575.0   | Icons                            | For sidebar navigation icons     |

### No Additional Installation Required

All required @kobalte/core components are already part of the existing installation.

## Architecture Patterns

### Recommended Project Structure

```
apps/desktop/src/components/
├── ui/
│   ├── dialog.tsx         (existing)
│   ├── select.tsx         (NEW - UI-01)
│   ├── switch.tsx         (NEW - UI-02)
│   └── ...
├── settings/
│   ├── index.ts           (exports)
│   ├── settings-row.tsx   (NEW - UI-03)
│   ├── settings-section.tsx (NEW - UI-04)
│   ├── settings-sidebar.tsx (NEW - DIALOG-02)
│   └── settings-dialog.tsx (NEW - DIALOG-01)
```

### Pattern 1: Component Wrapper Pattern

**What:** Wrap @kobalte/core primitives with ekacode-specific styling

**When to use:** For any new UI component based on @kobalte/core

**Example:**

```typescript
// Source: Based on text-field.tsx and dropdown-menu.tsx patterns
import * as SelectPrimitive from "@kobalte/core/select";
import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import { splitProps } from "solid-js";
import { cn } from "@/utils";

type SelectProps<T extends ValidComponent> = SelectPrimitive.SelectRootProps<T> & {
  class?: string;
};

const Select = <T extends ValidComponent = "button">(
  props: PolymorphicProps<T, SelectProps<T>>
) => {
  const [local, others] = splitProps(props as SelectProps<T>, ["class"]);
  return (
    <SelectPrimitive.Root class={cn("ekacode-select-styles", local.class)} {...others} />
  );
};
```

### Pattern 2: Controlled Dialog Pattern

**What:** Use open + onOpenChange props for controlled dialogs

**When to use:** For SettingsDialog and any modal dialogs

**Example:**

```typescript
// Source: Based on command.tsx and existing usage
<Dialog open={isOpen()} onOpenChange={setIsOpen}>
  <DialogTrigger>Open Settings</DialogTrigger>
  <DialogContent>
    {/* Dialog content */}
  </DialogContent>
</Dialog>
```

### Pattern 3: Two-Column Grid Layout

**What:** CSS Grid with sidebar + content columns

**When to use:** For SettingsDialog main content area

**Example:**

```typescript
// Source: provider-settings.tsx line 919
<div class="grid h-[560px] min-h-0 gap-0 md:grid-cols-[1.1fr_1.4fr]">
  <div class="border-border/80 min-h-0 border-r">
    {/* Sidebar - DIALOG-02 */}
  </div>
  <div class="min-h-0 overflow-y-auto">
    {/* Content area */}
  </div>
</div>
```

### Pattern 4: Bottom-Up Composition

**What:** Build from smallest to largest components

**When to use:** When implementing this phase

**Build order:**

1. UI-01: Select → UI-02: Switch → UI-03: SettingsRow → UI-04: SettingsSection → DIALOG-02: SettingsSidebar → DIALOG-01: SettingsDialog

### Anti-Patterns to Avoid

- **Destructuring props in SolidJS:** Never use `const { x } = props` - breaks reactivity. Use `props.x` or `splitProps`.
- **Creating custom Select/Switch from scratch:** Use @kobalte/core primitives - they handle accessibility, keyboard navigation, and edge cases
- **Using uncontrolled dialogs:** Always use controlled pattern (`open` + `onOpenChange`) for settings dialogs

## Don't Hand-Roll

| Problem                  | Don't Build                      | Use Instead                      | Why                                                     |
| ------------------------ | -------------------------------- | -------------------------------- | ------------------------------------------------------- |
| Select dropdown          | Custom dropdown with divs        | @kobalte/core/select             | Handles accessibility, keyboard nav, portal positioning |
| Toggle switch            | Custom checkbox styling          | @kobalte/core/switch             | Proper ARIA attributes, focus management                |
| Dialog overlay/animation | Custom backdrop + animations     | Existing Dialog + createPresence | Already implemented with proper animations              |
| Sidebar navigation state | Custom selected state management | Local signal or selectedId prop  | Simple enough for local state                           |

**Key insight:** @kobalte/core components provide accessibility (WAI-ARIA), focus management, and keyboard navigation out of the box. Custom implementations would require significant work to match.

## Common Pitfalls

### Pitfall 1: Breaking SolidJS Reactivity

**What goes wrong:** Components don't re-render when props change

**Why it happens:** Destructuring props: `const { value } = props`

**How to avoid:** Always access props via `props.value` or use `splitProps`:

```typescript
// BAD
const { value, onChange } = props;

// GOOD
const [local, others] = splitProps(props, ["value", "onChange"]);
```

### Pitfall 2: Missing Polymorphic Types

**What goes wrong:** TypeScript errors when using custom components

**Why it happens:** Not using PolymorphicProps type from @kobalte/core/polymorphic

**How to avoid:** Follow the existing pattern:

```typescript
import type { PolymorphicProps } from "@kobalte/core/polymorphic";

type MyComponentProps<T extends ValidComponent> = PrimitiveComponentProps<T> & { class?: string };

const MyComponent = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, MyComponentProps<T>>
) => {
  /* ... */
};
```

### Pitfall 3: Incorrect Dialog Portal Placement

**What goes wrong:** Dialog content appears in wrong position or gets clipped

**Why it happens:** Not using DialogPrimitive.Portal

**How to avoid:** Always wrap DialogPrimitive.Content in Portal (as shown in existing dialog.tsx)

### Pitfall 4: Hardcoding Component Styles

**What goes wrong:** Inconsistent styling with rest of app

**Why it happens:** Not following existing component patterns

**How to avoid:** Use existing component as reference (text-field.tsx, dropdown-menu.tsx) and follow their class patterns

## Code Examples

### Example 1: Select Component with Dark Theme

```typescript
// Pattern based on @kobalte/core select docs + existing patterns
import { Select as SelectPrimitive } from "@kobalte/core/select";
import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import { splitProps } from "solid-js";
import { For, Show } from "solid-js";
import { cn } from "@/utils";

export const Select = <T extends ValidComponent = "button">(
  props: PolymorphicProps<T, SelectProps<T>>
) => {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <SelectPrimitive.Root
      class={cn("relative", local.class)}
      {...others}
    >
      <SelectPrimitive.Trigger
        class={cn(
          "bg-background border-border flex h-10 w-full items-center justify-between rounded-lg border px-3 py-2 text-sm",
          "text-foreground placeholder:text-muted-foreground",
          "hover:border-ring/50 focus:border-ring focus:ring-ring/10 focus:outline-none focus:ring-4",
          "disabled:cursor-not-allowed disabled:opacity-50"
        )}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon class="text-muted-foreground">
          {/* Chevron icon */}
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          class={cn(
            "bg-popover text-popover-foreground z-50 min-w-[200px] overflow-hidden rounded-md border p-1 shadow-lg"
          )}
        >
          <SelectPrimitive.Listbox class="max-h-[300px] overflow-y-auto" />
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
};
```

### Example 2: Switch Component with Dark Theme

```typescript
// Pattern based on @kobalte/core switch docs
import { Switch as SwitchPrimitive } from "@kobalte/core/switch";
import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import { splitProps } from "solid-js";
import { cn } from "@/utils";

type SwitchProps<T extends ValidComponent = "button"> =
  SwitchPrimitive.SwitchRootProps<T> & { class?: string };

export const Switch = <T extends ValidComponent = "button">(
  props: PolymorphicProps<T, SwitchProps<T>>
) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SwitchPrimitive.Root
      class={cn(
        "bg-muted peer-focus-visible:ring-ring peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2",
        "peer-focus-visible:ring-offset-background",
        "data-[checked]:bg-primary",
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        local.class
      )}
      {...others}
    >
      <SwitchPrimitive.Thumb
        class={cn(
          "bg-foreground pointer-events-none block h-5 w-5 rounded-full shadow-lg ring-0 transition-transform",
          "data-[checked]:translate-x-5 data-[unchecked]:translate-x-0"
        )}
      />
    </SwitchPrimitive.Root>
  );
};
```

### Example 3: SettingsRow Component

```typescript
// Settings row with label + description + control
interface SettingsRowProps {
  label: string;
  description?: string;
  children: JSX.Element;
  class?: string;
}

export const SettingsRow = (props: SettingsRowProps) => {
  return (
    <div class={cn("flex items-center justify-between gap-4 py-3", props.class)}>
      <div class="flex-1">
        <p class="text-sm font-medium text-foreground">{props.label}</p>
        <Show when={props.description}>
          <p class="text-muted-foreground text-xs">{props.description}</p>
        </Show>
      </div>
      <div class="flex-shrink-0">{props.children}</div>
    </div>
  );
};
```

### Example 4: SettingsSection Component

```typescript
// Section header with optional description
interface SettingsSectionProps {
  title: string;
  description?: string;
  children: JSX.Element;
}

export const SettingsSection = (props: SettingsSectionProps) => {
  return (
    <div class="mb-6">
      <div class="mb-3 border-b border-border pb-2">
        <h3 class="text-sm font-semibold text-foreground">{props.title}</h3>
        <Show when={props.description}>
          <p class="text-muted-foreground text-xs">{props.description}</p>
        </Show>
      </div>
      <div class="space-y-1">{props.children}</div>
    </div>
  );
};
```

### Example 5: SettingsDialog with Two-Column Layout

```typescript
// Based on provider-settings.tsx line 919 pattern
interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const SettingsDialog = (props: SettingsDialogProps) => {
  const [selectedId, setSelectedId] = createSignal("general");

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent class="h-[640px] w-[900px] max-w-[90vw] p-0">
          <div class="grid h-full md:grid-cols-[1.1fr_1.4fr]">
            {/* Sidebar - DIALOG-02 */}
            <div class="border-border/80 min-h-0 border-r bg-background/50">
              <SettingsSidebar
                selectedId={selectedId()}
                onSelect={setSelectedId}
              />
            </div>
            {/* Content - Dynamic based on selectedId */}
            <div class="min-h-0 overflow-y-auto p-6">
              <Show when={selectedId() === "general"}>
                {/* General tab content */}
              </Show>
            </div>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
};
```

## State of the Art

| Old Approach                 | Current Approach                        | When Changed  | Impact                     |
| ---------------------------- | --------------------------------------- | ------------- | -------------------------- |
| Custom Select with divs      | @kobalte/core/select                    | Project start | Better accessibility       |
| Native checkbox as toggle    | @kobalte/core/switch                    | Project start | Proper ARIA switch role    |
| Custom dialog implementation | @kobalte/core/dialog + existing wrapper | Project start | Consistent modal behavior  |
| CSS Grid with fixed pixels   | CSS Grid with fr units + min-h-0        | 2024          | Better responsive behavior |

**Deprecated/outdated:**

- None relevant to this phase

## Open Questions

1. **Icon library choice**
   - What we know: Both custom Icon component and lucide-solid are available in package.json
   - What's unclear: Which icons are available in the custom Icon component vs lucide-solid
   - Recommendation: Check existing Icon component first; expand it if needed rather than using lucide-solid

2. **SettingsRow/SettingsSection location**
   - What we know: Need atomic components for settings UI
   - What's unclear: Should they be in `/components/ui/` or `/components/settings/`
   - Recommendation: Put in `/components/settings/` since they're application-specific

3. **Animation requirements**
   - What we know: Dialog uses createPresence for animations
   - What's unclear: Should sidebar selection have animations
   - Recommendation: Keep simple initially; add transitions if needed

## Sources

### Primary (HIGH confidence)

- @kobalte/core v0.13.11 (installed in apps/desktop)
- apps/desktop/src/components/ui/dialog.tsx - Existing Dialog wrapper
- apps/desktop/src/components/ui/text-field.tsx - Component pattern reference
- apps/desktop/src/components/ui/dropdown-menu.tsx - Component pattern reference
- apps/desktop/src/components/ui/collapsible.tsx - Component pattern reference
- apps/desktop/src/views/components/provider-settings.tsx line 919 - Two-column grid pattern
- kobalte.dev/docs/core/components/select/ - Select API
- kobalte.dev/docs/core/components/switch/ - Switch API

### Secondary (MEDIUM confidence)

- apps/desktop/src/components/ui/command.tsx - CommandDialog pattern
- apps/desktop/src/components/model-selector.tsx - Complex dialog usage
- kobalte.dev/docs/core/components/dialog/ - Dialog API

### Tertiary (LOW confidence)

- None needed

## Metadata

**Confidence breakdown:**

- Standard Stack: HIGH - All libraries already in use; version confirmed
- Architecture: HIGH - Existing patterns in codebase provide strong guidance
- Pitfalls: HIGH - Based on existing codebase patterns and verified @kobalte/core docs
- Code Examples: HIGH - Based on existing working components

**Research date:** 2026-02-22
**Valid until:** 2026-03-22 (30 days - @kobalte/core is stable)
