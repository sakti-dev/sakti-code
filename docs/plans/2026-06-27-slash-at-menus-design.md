# Slash (`/`) & At (`@`) Context Menus — Design

**Goal:** Let the user invoke commands/skills and attach files from inside the chat input by typing a trigger character that opens a command palette. Typing `/` opens a palette of commands + skills; typing `@` opens a palette of project files. Picking an item inserts a **text token** into the textarea; the server interprets the token at prompt time.

**Status:** Design (no code). Implementation plan is produced separately by the writing-plans step.

---

## Scope

**In scope (v1):**
- `/` menu → **Commands** (`/name`) + **Skills** (`skill:name`).
- `@` menu → **Files** (`@relative/path`).
- A server-side **prompt preprocessor** that interprets the three token types.
- A new `GET /api/projects/:id/skills` route + wiring skills/commands into the harness `resources`.

**Out of scope (deferred):**
- **`@agent` (custom/builtin agents)** — deferred. No per-turn agent semantics designed yet; the `@` menu is files-only for now. The data plumbing (builtins constant, `GET /api/projects/:id/agents`, WS `switchAgent`) already exists server-side and can be wired later without rework.
- Token chips / rich inline rendering in the textarea (tokens are plain editable text).

---

## UI design

**Component:** reuse the existing `CommandDialog` from `apps/desktop/src/components/ui/command.tsx` — a centered modal `Dialog` wrapping `CommandRoot`/`CommandInput`/`CommandList`/`CommandGroup`/`CommandItem`. **Not** an anchored popover.

**Reference consumer:** `apps/desktop/src/components/commands/model-seletor/index.tsx` (+ `hooks.ts`) is the one existing palette; it opens a `CommandDialog` with its own search input, hand-rolled keyboard nav, and a `createResource` data fetch. We mirror that pattern.

**Trigger detection (in `chat-input.tsx`):** the textarea's input/keydown handler watches for the trigger char, with **position-dependent rules:**

| Trigger | Fires when typed at |
| :--- | :--- |
| `/` | caret position **0 only** (slash commands are start-of-message) |
| `@` | **any** caret position (inline file mentions mid-sentence) |

> Note: `@` at any position means email-like `user@host` will also open the menu. Accepted trade-off — the file search returns nothing useful and the user Esc-dismisses. (Whitespace-preceding rules are deliberately NOT applied to `@`.)

**Open/close lifecycle:**
- On trigger: record the trigger char's index, open `CommandDialog`, focus its `CommandInput` (starts empty — the user filters *inside* the dialog, not in the textarea).
- **Pick:** replace the trigger char in the textarea with the produced token, close the dialog, refocus the textarea with the caret placed after the token.
- **Esc / click-outside:** cancel, leave the textarea exactly as the user left it (the lone trigger char stays; user backspaces if unwanted).
- **Keyboard nav:** ↑↓ move, Enter picks, Esc closes. Lives in a shared `useListNavigation` hook, because `CommandItem` only exposes `onClick`/`onPick` (`command.tsx:142`) — no built-in arrow-key handling. The model-selector already implements this nav in `model-seletor/hooks.ts`; extract/reuse that pattern (no virtualization needed unless a group exceeds ~100 items; files endpoint is capped at 20).

**Menu contents & grouping:**

| Mode | Group | Items | Token inserted |
| :--- | :--- | :--- | :--- |
| `/` | Commands | from `GET /api/projects/:id/commands` | `/name` |
| `/` | Skills | from `GET /api/projects/:id/skills` (new) | `skill:name` |
| `@` | Files | from `GET /api/projects/:id/files?query=<dialog query>&limit=20` | `@relative/path` |

- `/` filtering is client-side over `name` + `description`.
- `@` (files) filtering is **server-side** (the frecency endpoint takes the query); the dialog query is debounced before each fetch.

---

## Data sources

| Need | Source | Status |
| :--- | :--- | :--- |
| Commands | `GET /api/projects/:id/commands` (`routes/projects/context.ts:12`) ← `loadCommands` over `~/.sakti/agent` + `<cwd>/.agents` `command\|commands/*.md` | **exists** |
| Skills | `loadSkills` (`context-loader.ts:45`) | loader exists; **route missing** → add `GET /api/projects/:id/skills` |
| Files | `GET /api/projects/:id/files?query=&limit=` (`routes/projects/search-files.ts`) ← fff/fd/find frecency | **exists** |
| Project cwd | `server.store.sessions[id]` → project → `cwd` | **exists** in desktop store |

All three project-scoped routes are composed into the app (`app.ts:34-35`) and typed via the Hono RPC client (`hc<App>` in `apps/desktop/src/lib/api.ts`) — no client codegen.

---

## Token contract (frontend ↔ server)

Picking an item inserts a plain-text token into the message. A new **prompt preprocessor** in `apps/server/src/agent/runner.ts` (run before `harness.prompt(raw)`, which today at `runner.ts:458` sends text straight through) scans the message and resolves tokens:

| Token | Preprocessor action |
| :--- | :--- |
| `/name [args]` | `harness.promptFromTemplate(name, args)` — `$1`/`$@`/`$ARGUMENTS` substitution already implemented (`agent-harness.ts:970`, `prompt-templates.ts:264`) |
| `skill:name` | `harness.skill(name)` (`agent-harness.ts:938`) |
| `@relative/path` | read the file from the project `cwd`, attach its content to the turn as context |

**`@file` semantics (default, unless overridden):** attach the file's **content** to the turn (like Claude Code's `@file`), not a mere path hint. Size-capped (e.g. truncate past N lines/bytes with a `[truncated]` note) so a huge file can't blow context. Path resolution is relative to the project `cwd`; unreadable/missing files produce a user-visible error note in the turn rather than crashing the prompt.

Tokens may appear anywhere in the message; the preprocessor scans the whole text. Unrecognized text passes through unchanged as a normal prompt.

---

## Server work (v1)

1. **Prompt preprocessor** in `runner.ts` — parses `/name`, `skill:name`, `@path` and dispatches to the harness / file reader before `harness.prompt`. This is the shared piece all three token types ride on.
2. **`GET /api/projects/:id/skills` route** — extend `routes/projects/context.ts` (the loader already runs in `context-loader.ts`; only the HTTP exposure is missing).
3. **Harness `resources` wiring** — `runner.ts:358` currently builds the harness with **no** `resources:`, so `harness.skill()` / `harness.promptFromTemplate()` would throw "Unknown skill/template" at runtime. Wire `{ skills, promptTemplates }` from the loaded `AgentContext` into the harness constructor.

---

## Decisions log

| Decision | Rationale |
| :--- | :--- |
| `CommandDialog` (centered modal), not a popover | Reuses the existing component + the one proven consumer (`model-selector`); removes caret-anchoring math. User direction. |
| `/` at caret 0 only; `@` anywhere | Slash = command mode (start of message); `@` = inline mention. User direction. |
| All picks insert **text tokens**, server interprets later | Symmetric across menus; keeps the textarea a plain editable string; one preprocessor serves all token types. |
| `@file` attaches content (capped), not a hint | Matches user expectation from other tools; a bare path hint is too weak to be useful. |
| `@agent` deferred | No per-turn agent semantics wanted yet; avoids a new runtime path in the harness. Data plumbing stays ready for later. |
| Skills listed with `skill:` prefix | Distinguishes skill tokens from `/command` tokens in the preprocessor; user direction. |
| Keyboard nav in a shared `useListNavigation` hook | `CommandItem` has no built-in nav; model-selector already hand-rolls it — extract once rather than duplicate. |

---

## Risks (ranked)

1. **Trigger-detection edge cases** — getting "caret 0 for `/`" and "anywhere for `@`" right across IME/paste/undo. Test first.
2. **Keyboard-nav hook extraction** — pulling the model-selector's nav into a shared hook without regressing the model selector.
3. **Skills harness wiring** — touches `runner.ts` (the one backend change with a test surface); `resources:` must be populated or `harness.skill()` throws.
4. **`@file` path resolution & size** — relative-to-cwd correctness, missing-file handling, truncation.

---

## Relevant files

- `apps/desktop/src/components/chat-input/chat-input.tsx` — input; `value` signal (l.28), `handleKeyDown` Enter-only (l.107), `send()` (l.98).
- `apps/desktop/src/components/ui/command.tsx` — `CommandDialog`/`CommandInput`/`CommandList`/`CommandGroup`/`CommandItem` (no built-in nav).
- `apps/desktop/src/components/commands/model-seletor/{index.tsx,hooks.ts}` — reference palette (dialog + nav + `createResource` fetch).
- `apps/desktop/src/components/chat-input/profile-select.tsx` — reference for project-scoped `createResource` fetch + action pattern.
- `apps/server/src/routes/projects/context.ts` — `/commands`, `/agents` (add `/skills` here).
- `apps/server/src/routes/projects/search-files.ts` — `/files` (frecency).
- `apps/server/src/lib/context-loader.ts` — `loadCommands`/`loadSkills`/`loadAgents`.
- `apps/server/src/agent/runner.ts` — harness construction (l.358, needs `resources:`) + prompt send (l.458, needs preprocessor).
- `packages/agent/src/harness/agent-harness.ts` — `promptFromTemplate` (l.970), `skill` (l.938).
