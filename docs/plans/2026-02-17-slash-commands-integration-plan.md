# Slash Commands Integration Plan

## Overview

This document outlines a comprehensive plan to integrate slash commands functionality into the ekacode desktop application. The implementation is modeled after the OpenCode slash command system but adapted to work with the existing **ModelSelector** component as a unified "Command Center".

## Architecture Overview

### Current State

1. **ModelSelector** (`apps/desktop/src/components/model-selector.tsx`)
   - Already handles `/model`, `/mcp`, `/skills` prefixes via mode pills
   - Opens dialog for model selection, MCP management, skills
   - Supports `@` for file/context mentions
   - Uses `CommandDialog` from `@/components/ui/command`

2. **Chat Input** (`apps/desktop/src/views/workspace-view/chat-area/chat-input.tsx`)
   - Detects `/model`, `/mcp`, `/skills` prefixes and opens ModelSelector
   - Detects `@` for context mentions
   - Already has `commandMode` state management

3. **Core Package** (`packages/core/src/`)
   - Has session management (`SessionController`, `SessionManager`)
   - Has tools registry (`toolRegistry`)
   - Has agent system (`HybridAgent`, `createAgent`, etc.)

### Target State - Unified Command Center

The `ModelSelector` will be expanded into a unified "Command Center" that supports:

| Mode      | Trigger   | Purpose                                          |
| --------- | --------- | ------------------------------------------------ |
| `command` | `/`       | Slash commands (new, undo, redo, terminal, etc.) |
| `model`   | `/model`  | Model selection                                  |
| `mcp`     | `/mcp`    | MCP server management                            |
| `skills`  | `/skills` | Skill selection                                  |
| `context` | `@`       | File/context mentions                            |

### UI Flow

```
User types "/" → ChatInput detects → opens ModelSelector with mode="command"
                                                        ↓
                                              Filter commands by input
                                                        ↓
                                              User selects command
                                                        ↓
                                              Execute command action
```

## Implementation Plan

### Phase 1: Core Command System (packages/core)

#### 1.1 Create Command Types

**File**: `packages/core/src/chat/commands.ts` (new)

```typescript
export interface SlashCommand {
  id: string;
  trigger: string;
  title: string;
  description?: string;
  keybind?: string;
  type: "builtin" | "custom";
  source?: "command" | "mcp" | "skill";
  disabled?: boolean;
  onSelect?: (source: "slash") => void;
}

export interface CommandCatalogItem {
  title: string;
  description?: string;
  category?: string;
  keybind?: string;
  slash?: string;
}
```

**Tests** (`packages/core/tests/chat/commands.test.ts`):

- Test command registration
- Test command execution

#### 1.2 Define Built-in Commands

**File**: `packages/core/src/chat/commands-builtin.ts` (new)

Built-in commands to implement:
| ID | Slash | Title | Description |
|---|---|---|---|
| session.new | new | New Session | Start a new session |
| session.undo | undo | Undo | Revert to previous message |
| session.redo | redo | Redo | Restore reverted message |
| session.compact | compact | Compact | Summarize session |
| session.fork | fork | Fork | Fork session |
| session.share | share | Share | Share session |
| session.unshare | unshare | Unshare | Remove sharing |
| terminal.toggle | terminal | Toggle Terminal | Show/hide terminal |
| terminal.new | - | New Terminal | Open new terminal |
| model.choose | model | Choose Model | Select model |
| mcp.toggle | mcp | Toggle MCP | Manage MCP servers |
| agent.cycle | agent | Cycle Agent | Switch agent |
| steps.toggle | steps | Toggle Steps | Show/hide steps |

**Tests**:

- Test each command exists with correct properties

### Phase 2: Update ModelSelector for Commands (apps/desktop)

#### 2.1 Extend CommandCenterMode Type

**File**: `apps/desktop/src/components/model-selector.tsx`

Change:

```typescript
// From:
export type CommandCenterMode = "model" | "mcp" | "skills" | "context";

// To:
export type CommandCenterMode = "model" | "mcp" | "skills" | "context" | "command";
```

#### 2.2 Add Mode Pill for Commands

**File**: `apps/desktop/src/components/model-selector.tsx`

Change:

```typescript
const MODE_PILLS: Array<{ mode: CommandCenterMode; label: string }> = [
  { mode: "command", label: "/command" }, // NEW
  { mode: "model", label: "/model" },
  { mode: "mcp", label: "/mcp" },
  { mode: "skills", label: "/skills" },
  { mode: "context", label: "@context" },
];
```

#### 2.3 Add Props for Slash Commands

**File**: `apps/desktop/src/components/model-selector.tsx`

Add to `ModelSelectorProps`:

```typescript
interface ModelSelectorProps {
  // ... existing props ...

  // NEW: Slash command props
  slashCommands?: SlashCommandEntry[];
  onSlashCommand?: (command: SlashCommandEntry) => void;
}

interface SlashCommandEntry {
  id: string;
  trigger: string;
  title: string;
  description?: string;
  keybind?: string;
  type: "builtin" | "custom";
  source?: "command" | "mcp" | "skill";
}
```

#### 2.4 Add Command Mode Rendering

**File**: `apps/desktop/src/components/model-selector.tsx`

Add case for `command` mode in `commandEntries`:

```typescript
const commandEntries = createMemo(() => {
  switch (props.mode) {
    case "command":
      return props.slashCommands ?? [];
    case "mcp":
      return MCP_ENTRIES;
    case "skills":
      return SKILL_ENTRIES;
    default:
      return [];
  }
});
```

Update header text:

```typescript
<p class="text-popover-foreground text-[13px] font-semibold tracking-tight">
  {props.mode === "context" ? "Adding context"
   : props.mode === "command" ? "Commands"  // NEW
   : "Selecting model"}
</p>
```

Update placeholder:

```typescript
placeholder={
  props.mode === "model"
    ? "Search providers and models..."
    : props.mode === "mcp"
      ? "Search MCP commands..."
      : props.mode === "skills"
        ? "Search skills..."
        : props.mode === "command"  // NEW
          ? "Search commands..."
          : "Search files and directories to add context..."
}
```

Add command execution handler:

```typescript
const handleCommandPick = () => {
  const cmd = commandEntries()[activeIndex()];
  if (props.mode === "command" && cmd) {
    props.onSlashCommand?.(cmd);
  }
  props.onOpenChange(false);
  setQuery("");
};
```

**Tests** (`apps/desktop/src/components/model-selector.test.tsx`):

- Test command mode renders
- Test slash commands display
- Test command selection triggers callback

### Phase 3: Update ChatInput Integration (apps/desktop)

#### 3.1 Add Command Detection

**File**: `apps/desktop/src/views/workspace-view/chat-area/chat-input.tsx`

Update `handleInput`:

```typescript
const handleInput = (e: InputEvent & { currentTarget: HTMLTextAreaElement }) => {
  const value = e.currentTarget.value;
  setInputValue(value);
  merged.onValueChange?.(value);
  autoResize();

  const trimmed = value.trimStart();

  // EXISTING: /model, /mcp, /skills
  if (trimmed.startsWith("/model")) {
    setCommandMode("model");
    setModelSearch(trimmed.slice("/model".length).trim());
    setIsModelSelectorOpen(true);
    return;
  }
  // ... other existing handlers ...

  // NEW: Detect "/" for command mode
  if (
    trimmed.startsWith("/") &&
    !trimmed.startsWith("/model") &&
    !trimmed.startsWith("/mcp") &&
    !trimmed.startsWith("/skills")
  ) {
    setCommandMode("command");
    setModelSearch(trimmed.slice(1).trim());
    setIsModelSelectorOpen(true);
    return;
  }

  // EXISTING: @ for context
  if (/(^|\s)@([^\s]*)$/.test(value)) {
    setCommandMode("context");
    const searchQuery = value.split("@").pop()?.trim() ?? "";
    setModelSearch(searchQuery);
    setIsModelSelectorOpen(true);
  }
};
```

#### 3.2 Pass Slash Commands to ModelSelector

**File**: `apps/desktop/src/views/workspace-view/chat-area/chat-input.tsx`

Add props to ModelSelector:

```typescript
<ModelSelector
  // ... existing props ...
  slashCommands={slashCommands()}     // NEW
  onSlashCommand={handleSlashCommand} // NEW
/>
```

#### 3.3 Add Command Handler

**File**: `apps/desktop/src/views/workspace-view/chat-area/chat-input.tsx`

Add handler:

```typescript
const handleSlashCommand = (cmd: SlashCommandEntry) => {
  setInputValue("");
  merged.onValueChange?.("");
  cmd.onSelect?.("slash");
};
```

**Tests** (`apps/desktop/src/views/workspace-view/chat-area/chat-input.test.tsx`):

- Test `/` triggers command mode
- Test `/undo` filters to undo command
- Test command execution clears input

### Phase 4: Create Command Hook (apps/desktop)

#### 4.1 Create useCommands Hook

**File**: `apps/desktop/src/core/chat/hooks/use-commands.ts` (new)

- Register built-in commands
- Connect to session controller
- Handle command execution
- Expose commands for ModelSelector

```typescript
export interface UseCommandsOptions {
  sessionId: string;
  onNewSession?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onCompact?: () => void;
  onShare?: () => void;
  onUnshare?: () => void;
  onToggleTerminal?: () => void;
}

export function useCommands(options: UseCommandsOptions) {
  const [commands, setCommands] = createSignal<SlashCommandEntry[]>([]);

  useEffect(() => {
    const builtins: SlashCommandEntry[] = [
      {
        id: "session.new",
        trigger: "new",
        title: "New Session",
        description: "Start a new session",
        keybind: "mod+shift+s",
        type: "builtin",
        onSelect: () => options.onNewSession?.(),
      },
      {
        id: "session.undo",
        trigger: "undo",
        title: "Undo",
        description: "Revert to previous message",
        keybind: "mod+z",
        type: "builtin",
        onSelect: () => options.onUndo?.(),
      },
      // ... more commands
    ];
    setCommands(builtins);
  }, []);

  return { commands };
}
```

**Tests**:

- Test commands are registered
- Test command execution

### Phase 5: Session Integration

#### 5.1 Connect Commands to Session Controller

**File**: `packages/core/src/session/controller.ts`

Add methods for:

- `revert(messageId: string)` - revert to previous state
- `unrevert()` - restore reverted state
- `summarize()` - compact session
- `share()` / `unshare()` - sharing

#### 5.2 Update SessionManager

**File**: `packages/core/src/session/manager.ts`

Connect command execution to session operations.

**Tests** (`packages/core/tests/session/commands.test.ts`):

- Test undo reverts session
- Test redo restores state
- Test compact creates summary
- Test share generates URL

### Phase 6: Integration Tests

#### 6.1 E2E Command Flow

**File**: `apps/desktop/src/e2e/commands/slash-commands.spec.ts` (new)

Tests:

- Type `/` shows command popover
- Type `/undo` filters to undo command
- Press Enter executes command
- Keyboard navigation works

## Test Files to Create

```
packages/core/tests/
├── chat/
│   └── commands.test.ts         # Command types & built-in commands

apps/desktop/src/
├── components/
│   └── model-selector.test.tsx  # Test command mode rendering
├── views/workspace-view/chat-area/
│   └── chat-input.test.tsx     # Slash detection & filtering
└── core/chat/hooks/
    └── use-commands.test.ts    # Command registration

apps/desktop/src/e2e/
└── commands/
    └── slash-commands.spec.ts  # E2E tests
```

## Implementation Order (TDD)

1. **Write failing test** for command types in `packages/core`
2. **Implement** `SlashCommand` interface
3. **Write failing test** for built-in commands
4. **Implement** built-in commands
5. **Write failing test** for ModelSelector command mode
6. **Update** ModelSelector to support "command" mode
7. **Write failing test** for ChatInput slash detection
8. **Update** ChatInput to detect `/` and route to command mode
9. **Write failing test** for useCommands hook
10. **Implement** useCommands hook
11. **Run** E2E tests to verify full flow

## Key Implementation Details

### Command Detection Priority

```
1. "/model" → mode="model"
2. "/mcp" → mode="mcp"
3. "/skills" → mode="skills"
4. "/" or "/<anything-else>" → mode="command"
5. "@" → mode="context"
```

### Command Execution Flow

```
User types "/" → handleInput detects "/"
                  ↓
setCommandMode("command") + setIsModelSelectorOpen(true)
                  ↓
ModelSelector renders with mode="command"
                  ↓
User types "undo" → filters to undo command
                  ↓
User presses Enter → handleSlashCommand(cmd)
                  ↓
cmd.onSelect("slash") executes → session.revert()
```

### Keyboard Navigation

- Arrow Up/Down: Navigate commands
- Enter: Execute selected command
- Escape: Close dialog

### Keybind Handling

- `mod` = Cmd on Mac, Ctrl on Windows
- Parse `keybind` string (e.g., "mod+shift+s") into modifiers + key

## UI/UX Specifications

### ModelSelector in Command Mode

The command mode renders similarly to skills/mcp mode:

```tsx
<CommandGroup heading="Commands">
  <For each={commandEntries()}>
    {cmd => (
      <CommandItem
        value={cmd.id}
        onPick={() => handleSlashCommand(cmd)}
      >
        <span class="truncate">/{cmd.trigger}</span>
        <span class="text-muted-foreground ml-auto text-[11px]">
          {cmd.description}
        </span>
        .keybind}>
         <Show when={cmd <kbd class="ml-2">{cmd.keybind}</kbd>
        </Show>
      </CommandItem>
    )}
  </For>
</CommandGroup>
```

### Badge Display

For custom commands (from skills/MCP), show badges:

- Skill: "skill" badge
- MCP: "mcp" badge
- Custom: "custom" badge

## References

- OpenCode implementation: `opencode/packages/app/src/components/prompt-input/slash-popover.tsx`
- OpenCode command system: `opencode/packages/app/src/context/command.tsx`
- OpenCode session commands: `opencode/packages/app/src/pages/session/use-session-commands.tsx`
- Existing ModelSelector: `apps/desktop/src/components/model-selector.tsx`
- Existing ChatInput: `apps/desktop/src/views/workspace-view/chat-area/chat-input.tsx`
