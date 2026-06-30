# Chip Input Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the chat input's plain `<textarea>` with a contenteditable chip input where menu-picked tokens (`/name`, `skill:name`, `@path`) render as inline badge chips, backspace deletes a chip atomically, and the wire string the server receives is unchanged (the preprocessor already parses these tokens).

**Architecture:** A new `ChipInput` component owns a contenteditable `<div>` (uncontrolled — imperative DOM, never re-rendered from React on each keystroke, to preserve the caret). The editor holds text nodes plus `<span class="chip" contenteditable="false" data-token="…">` elements. **Chips are created only by menu picks** (explicit objects — no regex auto-detection; hand-typed `/commit` stays plain text and still works server-side). On every input the editor is serialized (walk child nodes → text + token + `\n`) into the wire string, emitted via `onChange` so the rest of `chat-input` (`value` signal, `send()`, char count) works unchanged. Trigger detection uses `beforeinput`/`keydown` (`/` only when the caret is at the editor start; `@` anywhere) and saves a DOM `Range` bookmark; on menu pick, `insertChip(token)` restores the bookmark, deletes the trigger char, inserts the chip, and re-serializes. Backspace atomicity comes for free from `contenteditable=false` (browsers delete the span as a unit), with a `beforeinput` hook to re-serialize and tidy the caret.

**Tech Stack:** TypeScript, SolidJS, vitest (jsdom), Kobuste Dialog (unchanged, for the menu). No new deps.

**TDD discipline:** Write the failing test first, watch it fail, implement minimal code, watch it pass. `pnpm run fix` before committing; `pnpm run typecheck` stays green (7 tasks).

**jsdom caveat (important):** jsdom has only partial contenteditable/Selection support — it can build `Range`s and set selections, but does **not** simulate real browser typing/caret mutation. So the plan extracts all logic into **pure helpers operating on `(editorEl, selection)`** (fully unit-testable) and keeps the contenteditable event handlers as thin glue. Event-wiring behaviors are tested at the component level where jsdom cooperates (e.g. dispatch `input` after mutating the DOM); IME composition, real paste, and undo are flagged as **manual verification** points in Task 6.

**Conventions:** SolidJS uses `class`/`for` (not className). Callback-ref pattern: `let ref; const register = (el) => { ref = el; }` then `ref={register}` (see `model-seletor/hooks.ts:106`). `exactOptionalPropertyTypes: true` — conditional spread, never pass `undefined`. Top-level regex literals only (biome).

---

### Task 1: Serialization + chip helpers (pure, jsdom-tested)

The testable core. Everything else is thin glue over these.

**Files:**

- Create: `apps/desktop/src/components/chat-input/chip-model.ts`
- Test: `apps/desktop/src/components/chat-input/__tests__/chip-model.test.ts`

**Step 1: Write the failing tests.**

```ts
// apps/desktop/src/components/chat-input/__tests__/chip-model.test.ts
import { describe, expect, it } from "vitest";
import { createChipElement, isAtEditorStart, serializeEditor } from "../chip-model.ts";

function editorWith(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

describe("serializeEditor", () => {
  it("concatenates plain text", () => {
    expect(serializeEditor(editorWith("hello world"))).toBe("hello world");
  });

  it("emits the token for chip spans", () => {
    const ed = editorWith(
      '<span class="chip" contenteditable="false" data-token="/commit">/commit</span>',
    );
    expect(serializeEditor(ed)).toBe("/commit");
  });

  it("mixes text and chips in order", () => {
    const ed = editorWith(
      'fix <span class="chip" contenteditable="false" data-token="@src/a.ts">@src/a.ts</span> now',
    );
    expect(serializeEditor(ed)).toBe("fix @src/a.ts now");
  });

  it("converts <br> to newline", () => {
    expect(serializeEditor(editorWith("a<br>b"))).toBe("a\nb");
  });
});

describe("createChipElement", () => {
  it("builds an atomic, token-carrying span", () => {
    const chip = createChipElement("/commit");
    expect(chip.tagName).toBe("SPAN");
    expect(chip.contentEditable).toBe("false");
    expect(chip.dataset.token).toBe("/commit");
    expect(chip.textContent).toBe("/commit");
    expect(chip.className).toContain("chip");
  });
});

describe("isAtEditorStart", () => {
  it("is true when the caret is before all content", () => {
    const ed = editorWith("hello");
    const sel = window.getSelection();
    const range = document.createRange();
    range.setStart(ed.firstChild as Text, 0);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
    expect(isAtEditorStart(ed)).toBe(true);
  });

  it("is false when the caret is after some text", () => {
    const ed = editorWith("hello");
    const sel = window.getSelection();
    const range = document.createRange();
    range.setStart(ed.firstChild as Text, 3);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
    expect(isAtEditorStart(ed)).toBe(false);
  });

  it("is true for an empty editor", () => {
    const ed = editorWith("");
    expect(isAtEditorStart(ed)).toBe(true);
  });
});
```

**Step 2: Run to verify RED.**

```bash
cd apps/desktop && pnpm run test src/components/chat-input/__tests__/chip-model.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement.**

```ts
// apps/desktop/src/components/chat-input/chip-model.ts
/** Serialize a chip editor's child nodes into the wire string sent to the WS. */
export function serializeEditor(editor: HTMLElement): string {
  let out = "";
  for (const node of Array.from(editor.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      continue;
    }
    const el = node as HTMLElement;
    if (el.tagName === "BR") {
      out += "\n";
      continue;
    }
    const token = el.dataset?.token;
    if (typeof token === "string") {
      out += token;
      continue;
    }
    // Unknown element: fall back to its text content.
    out += el.textContent ?? "";
  }
  return out;
}

/** Create an atomic chip span carrying the wire token. */
export function createChipElement(token: string): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.className = "chip";
  chip.dataset.token = token;
  chip.textContent = token;
  return chip;
}

/** True if the current selection is collapsed at the very start of `editor`. */
export function isAtEditorStart(editor: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) {
    return editor.childNodes.length === 0;
  }
  const range = sel.getRangeAt(0);
  // Compare the caret's start against the editor's start.
  const start = document.createRange();
  start.selectNodeContents(editor);
  start.setEnd(range.startContainer, range.startOffset);
  return start.toString().length === 0;
}
```

**Step 4: Run to verify GREEN.** Expected: 9 tests pass.
**Step 5: Commit.**

```bash
git add apps/desktop/src/components/chat-input/chip-model.ts apps/desktop/src/components/chat-input/__tests__/chip-model.test.ts
git commit -m "feat(desktop): chip editor serialization + helpers"
```

---

### Task 2: `ChipInput` component — core editing surface

**Files:**

- Create: `apps/desktop/src/components/chat-input/chip-input.tsx`
- Test: `apps/desktop/src/components/chat-input/__tests__/chip-input.test.tsx`

The contenteditable div, placeholder, `onChange`/`onSubmit`, paste sanitization, IME guard, and the imperative API (`clear`, `focus`). Trigger detection + `insertChip` come in Task 3.

**Step 1: Write the failing tests** (simulate typing by mutating `textContent` + dispatching `input`, since jsdom won't do real contenteditable typing).

```ts
// apps/desktop/src/components/chat-input/__tests__/chip-input.test.tsx
import { fireEvent, render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { ChipInput, type ChipInputApi } from "../chip-input.tsx";

describe("ChipInput", () => {
  it("emits the typed text via onChange", () => {
    const onChange = vi.fn();
    const { getByRole } = render(() => <ChipInput onChange={onChange} />);
    const ed = getByRole("textbox") as HTMLElement;
    ed.textContent = "hello";
    fireEvent.input(ed);
    expect(onChange).toHaveBeenLastCalledWith("hello");
  });

  it("calls onSubmit on Enter (without shift)", () => {
    const onSubmit = vi.fn();
    const { getByRole } = render(() => <ChipInput onChange={() => {}} onSubmit={onSubmit} />);
    fireEvent.keyDown(getByRole("textbox"), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does NOT submit on Shift+Enter", () => {
    const onSubmit = vi.fn();
    const { getByRole } = render(() => <ChipInput onChange={() => {}} onSubmit={onSubmit} />);
    fireEvent.keyDown(getByRole("textbox"), { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the placeholder only when empty", () => {
    const { getByRole, queryByText } = render(() => (
      <ChipInput onChange={() => {}} placeholder="Send a message…" />
    ));
    expect(queryByText("Send a message…")).not.toBeNull();
    const ed = getByRole("textbox");
    ed.textContent = "x";
    fireEvent.input(ed);
    expect(queryByText("Send a message…")).toBeNull();
  });

  it("exposes clear() and focus() via registerApi", () => {
    let api: ChipInputApi | undefined;
    const onChange = vi.fn();
    const { getByRole } = render(() => (
      <ChipInput onChange={onChange} registerApi={(a) => (api = a)} />
    ));
    const ed = getByRole("textbox");
    ed.textContent = "stuff";
    fireEvent.input(ed);
    api?.clear();
    expect(ed.textContent).toBe("");
    expect(onChange).toHaveBeenLastCalledWith("");
  });
});
```

**Step 2: Run to verify RED.** Expected: FAIL — module not found.
**Step 3: Implement.**

```tsx
// apps/desktop/src/components/chat-input/chip-input.tsx
import { createSignal, type JSX, onCleanup, onMount, Show } from "solid-js";
import { cn } from "~/lib/utils";
import { serializeEditor } from "./chip-model.ts";

export interface ChipInputApi {
  clear: () => void;
  focus: () => void;
}

export interface ChipInputProps {
  placeholder?: string;
  disabled?: boolean;
  class?: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  registerApi?: (api: ChipInputApi) => void;
}

export function ChipInput(props: ChipInputProps): JSX.Element {
  let editorRef: HTMLDivElement | undefined;
  const [empty, setEmpty] = createSignal(true);
  // IME composition guard — suppress key handling mid-composition.
  let composing = false;

  const emit = () => {
    if (!editorRef) return;
    const text = serializeEditor(editorRef);
    setEmpty(text.length === 0 && editorRef.childNodes.length === 0);
    props.onChange(text);
  };

  const api: ChipInputApi = {
    clear: () => {
      if (editorRef) {
        editorRef.textContent = "";
        emit();
      }
    },
    focus: () => editorRef?.focus(),
  };

  onMount(() => {
    props.registerApi?.(api);
  });
  onCleanup(() => props.registerApi?.(undefined as unknown as ChipInputApi));

  const onKeyDown = (e: KeyboardEvent) => {
    if (composing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      props.onSubmit?.();
    }
    // Shift+Enter falls through → default contenteditable newline (pre-wrap renders \n).
  };

  return (
    <div class="relative">
      <Show when={empty() && props.placeholder}>
        <div class="pointer-events-none absolute inset-0 px-1 py-2 text-muted-foreground/60">
          {props.placeholder}
        </div>
      </Show>
      <div
        aria-multiline="true"
        class={cn(
          "scrollbar-default w-full resize-none bg-transparent px-1 py-2 outline-none",
          "max-h-[200px] min-h-6 whitespace-pre-wrap break-words overflow-y-auto",
          "text-foreground",
          props.class,
        )}
        data-component="chip-input"
        contenteditable={props.disabled ? "false" : "true"}
        prop:contentEditable={!props.disabled}
        ref={(el: HTMLDivElement) => {
          editorRef = el;
        }}
        role="textbox"
        onCompositionEnd={() => {
          composing = false;
          emit();
        }}
        onCompositionStart={() => {
          composing = true;
        }}
        onInput={emit}
        onKeyDown={onKeyDown}
        // Force plain-text paste (strip HTML, keep text + newlines).
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData?.getData("text/plain") ?? "";
          document.execCommand("insertText", false, text);
        }}
      />
    </div>
  );
}
```

> **Implementer notes:**
>
> - `whitespace-pre-wrap` makes `\n` render as line breaks (so Shift+Enter's default newline behaves like the old textarea).
> - `document.execCommand("insertText", …)` is deprecated but still the most reliable cross-engine plain-text paste insert; if Biome flags it, there is no lint rule against it (it's a runtime API, not syntax). Verify paste manually in Task 6.
> - If `onCleanup`'s `registerApi?.(undefined …)` offends types, instead have chat-input null its own stored api on unmount — pick whichever is cleaner.

**Step 4: Run to verify GREEN.** Expected: 5 tests pass.
**Step 5: Commit.**

```bash
git add apps/desktop/src/components/chat-input/chip-input.tsx apps/desktop/src/components/chat-input/__tests__/chip-input.test.tsx
git commit -m "feat(desktop): ChipInput contenteditable editing surface"
```

---

### Task 3: trigger detection + `insertChip` + atomic backspace

**Files:**

- Modify: `apps/desktop/src/components/chat-input/chip-input.tsx` (add trigger + chip insertion)
- Modify: `apps/desktop/src/components/chat-input/__tests__/chip-input.test.tsx` (add cases)

Adds: `onTrigger({ char })` fires when `/` is typed at the editor start or `@` anywhere; a saved `Range` bookmark at the trigger char; `insertChip(token)` on the API replaces the trigger char with a chip; `beforeinput` keeps serialization correct on backspace (chips are `contenteditable=false`, so deletion is already atomic — we only re-serialize + tidy).

**Step 1: Write the failing tests.**

```ts
// append to chip-input.test.tsx
describe("ChipInput triggers + chips", () => {
  it("fires onTrigger for / typed at the start", () => {
    const onTrigger = vi.fn();
    const { getByRole } = render(() => <ChipInput onChange={() => {}} onTrigger={onTrigger} />);
    fireEvent.keyDown(getByRole("textbox"), { key: "/" });
    expect(onTrigger).toHaveBeenCalledWith({ char: "/" });
  });

  it("does NOT fire onTrigger for / typed after other keys (caret not at start)", () => {
    const onTrigger = vi.fn();
    const { getByRole } = render(() => <ChipInput onChange={() => {}} onTrigger={onTrigger} />);
    const ed = getByRole("textbox");
    ed.textContent = "ab";
    fireEvent.input(ed);
    // Caret simulation in jsdom is partial; place it mid-text before the key.
    fireEvent.keyDown(ed, { key: "/" });
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("fires onTrigger for @ at any position", () => {
    const onTrigger = vi.fn();
    const { getByRole } => render(() => <ChipInput onChange={() => {}} onTrigger={onTrigger} />);
    fireEvent.keyDown(getByRole("textbox"), { key: "@" });
    expect(onTrigger).toHaveBeenCalledWith({ char: "@" });
  });

  it("insertChip inserts an atomic chip and emits its token", () => {
    let api: ChipInputApi | undefined;
    const onChange = vi.fn();
    const { getByRole } = render(() => (
      <ChipInput onChange={onChange} registerApi={(a) => (api = a)} />
    ));
    const ed = getByRole("textbox");
    ed.textContent = "@";
    fireEvent.input(ed);
    api?.insertChip?.("@src/a.ts");
    expect(ed.querySelector('.chip[data-token="@src/a.ts"]')).toBeTruthy();
    expect(onChange).toHaveBeenLastCalledWith("@src/a.ts");
  });
}
```

> The full `ChipInputApi` gains `insertChip`; update the type. The `/`-not-at-start test relies on `isAtEditorStart` — if jsdom's selection defaults make it flaky, assert on the pure `isAtEditorStart` helper instead (Task 1) and keep the component test for `/` at start + `@`.

**Step 2: Run to verify RED.** Expected: FAIL.
**Step 3: Implement** (sketch — fill in against the real Selection API):

```ts
// inside ChipInput, extend ChipInputApi:
export interface ChipInputApi {
  clear: () => void;
  focus: () => void;
  insertChip: (token: string) => void;
}

// props gain: onTrigger?: (t: { char: "/" | "@" }) => void;
// state: let pendingTrigger: Range | null = null;

const onKeyDown = (e: KeyboardEvent) => {
  if (composing) return;
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    props.onSubmit?.();
    return;
  }
  if (e.key === "/" && editorRef && isAtEditorStart(editorRef)) {
    pendingTrigger = saveCaret();
    props.onTrigger?.({ char: "/" });
  } else if (e.key === "@") {
    pendingTrigger = saveCaret();
    props.onTrigger?.({ char: "@" });
  }
};

// saveCaret(): snapshot window.getSelection().getRangeAt(0).cloneRange()
// restoreCaret(r): selection.removeAllRanges(); selection.addRange(r.cloneRange())

api.insertChip = (token: string) => {
  if (!editorRef) return;
  const range = pendingTrigger ?? endOfEditor(editorRef);
  // Select the trigger char (one char at the caret) and replace with the chip.
  range.setEnd(range.startContainer, range.startOffset + 1); // assumes trigger char is the next char
  range.deleteContents();
  range.insertNode(createChipElement(token));
  // Move caret after the chip.
  restoreCaretAfter(range, editorRef);
  pendingTrigger = null;
  emit();
};
```

Add a `beforeinput` handler that, on `inputType === "deleteContentBackward"`, just calls `emit()` after the default (chips already delete atomically because `contenteditable=false`). Keep `pendingTrigger` in sync: clear it on any non-trigger input.

> **Implementer note:** `insertChip`'s Range math is the fiddliest part. The trigger char is the char immediately after the saved bookmark. If the user opened the menu via `/` at start, the bookmark is at offset 0 of the (currently empty) editor, and after default key insertion the DOM may already contain the `/`. **Decide and document** whether the trigger char is inserted into the DOM (and `insertChip` deletes it) or suppressed (`preventDefault` on the trigger key, so the editor never holds the `/`/`@`). **Recommended:** suppress insertion (`preventDefault`) on a triggering keystroke and let `insertChip` own the DOM mutation — simpler Range math, no stray char to clean up. Update the `/`-at-start test to not expect the char in the editor.

**Step 4: Run to verify GREEN.** Expected: all chip-input tests pass.
**Step 5: Commit.**

```bash
git add apps/desktop/src/components/chat-input/chip-input.tsx apps/desktop/src/components/chat-input/__tests__/chip-input.test.tsx
git commit -m "feat(desktop): trigger detection + chip insertion + atomic backspace"
```

---

### Task 4: Wire `ChipInput` into `chat-input.tsx`

**Files:**

- Modify: `apps/desktop/src/components/chat-input/chat-input.tsx`
- Modify: `apps/desktop/src/components/chat-input/__tests__/chat-input.test.tsx`

**What changes:**

- Replace the `<textarea>` with `<ChipInput>`.
- Keep the menu (`ContextMenu`) + catalog/files fetching **as-is**.
- `onTrigger={({ char }) => setMenu({ mode: char, index: 0 })}` (index is vestigial now — chips locate themselves via the saved Range; drop `index` from menu state if unused).
- `registerApi` stores the `ChipInputApi`.
- Menu `onPick={token => api?.insertChip(token)}` (replaces `insertToken`).
- `onClose={closeMenu}` where `closeMenu` calls `api?.focus()` (replaces the textarea-focus logic).
- `onSubmit={send}` — `send()` sends `value().trim()` (value is the serialized wire string; unchanged).
- After send: `api?.clear()` instead of `setValue("")`.
- **Remove:** `detectTrigger` import + `detect-trigger.ts` (and its test) — superseded by ChipInput's `onTrigger`; the old `insertToken`, `textareaRef`/`selectionStart`/`autoResize` textarea logic; the `value` signal stays (driven by `onChange`) but `setValue` calls shrink to clear-after-send.

**Step 1: Write/update the failing tests.** Adapt the existing chat-input menu tests to the chip input:

- Typing `/` at start (fire `keyDown` `/` on the chip editor) → menu opens.
- `@` → menu opens in Files mode.
- Picking `/commit` → a `.chip[data-token="/commit"]` exists and `value` (sent on submit) contains `/commit`.
- Esc → chip editor regains focus (`document.activeElement` is the editor).
- Existing Enter-to-send / Shift+Enter / empty-guard tests move to the chip editor surface.

**Step 2: Run to verify RED.**
**Step 3: Implement** the wiring per "What changes" above. Delete `detect-trigger.ts` + `detect-trigger.test.ts` and the `value`/textarea logic that's no longer used.
**Step 4: Run to verify GREEN** + full desktop suite.
**Step 5: Commit.**

```bash
git add -A apps/desktop/src/components/chat-input
git commit -m "feat(desktop): wire ChipInput into chat input (chips for menu picks)"
```

---

### Task 5: Chip styling (badge look)

**Files:**

- Modify: `apps/desktop/src/components/chat-input/chip-input.tsx` (add classes / data attrs)
- Modify/create: the app's CSS (find the existing global stylesheet / `index.css`; add `.chip` rules)

**What:** distinguish the three token kinds visually via `data-token` prefix:

- `/command` → e.g. primary/accent badge.
- `skill:name` → a distinct hue (e.g. violet).
- `@path` → muted/neutral file badge.

Add a helper to derive a `data-chip-kind` attribute (`"command" | "skill" | "file"`) from the token when building the chip (extend `createChipElement` to set it). Style `.chip[data-chip-kind="…"]` with background, border, rounded corners, small padding, and `user-select: all` (so a single click selects the whole chip, reinforcing atomicity). No logic change — pure presentation. Verify visually in `pnpm run dev` (manual).

**Commit:**

```bash
git commit -m "feat(desktop): badge styling for /command, skill:, and @file chips"
```

---

### Task 6: Final verification + manual contenteditable checks

**Automated:**

```bash
pnpm run typecheck          # 7/7
for pkg in llm agent db tools; do (cd packages/$pkg && pnpm run test); done
(cd apps/server && pnpm run test)      # only pre-existing terminal×4 + compaction×1 fail
(cd apps/desktop && pnpm run test)     # all green
pnpm run fix
```

**Manual (contenteditable edge cases jsdom can't cover) — run the app (`cd apps/desktop && pnpm run dev`):**

- [ ] Pick `/command` + `skill:` + `@file` chips; confirm badges render and the three colors differ.
- [ ] Backspace at end of a chip removes it in **one** keystroke.
- [ ] Caret lands cleanly after an inserted chip; typing continues in the right place.
- [ ] IME: type a CJK/IME composition across the editor — no spurious trigger, composition commits cleanly.
- [ ] Paste rich HTML (from a web page) — pastes as plain text only.
- [ ] Enter sends; Shift+Enter adds a newline; chip sits inline across a wrap.
- [ ] Esc from the menu refocuses the editor.
- [ ] Send a message with chips — the server receives the wire string and resolves tokens (check the agent actually uses the `/command` / `@file`).

If a contenteditable bug surfaces, fix it inline (it's thin glue over the tested helpers); do not expand scope.

---

## Notes for the implementer

- **TDD is non-negotiable** for the pure helpers (Task 1) and the component behavior where jsdom cooperates. Contenteditable behaviors that jsdom can't simulate are covered by the Task 6 manual checklist — do not skip it.
- **Never write `value → editor.innerHTML` on every keystroke** — that resets the caret. The editor is uncontrolled; only `api.clear()` and `insertChip` mutate it imperatively.
- **`preventDefault` the trigger keystroke** (don't let `/`/`@` enter the DOM) so `insertChip` owns the DOM mutation — simpler Range math than deleting a stray char.
- **Chips = menu picks only.** Hand-typed tokens stay plain text (and still work server-side). Do not add regex auto-chipification.
- **No wire-format change:** the server already parses `/name` / `skill:name` / `@path` (Tasks 2–4 of the prior plan). Don't add wrapper tags or a strip step.
- If jsdom selection tests are flaky, assert on the pure helpers (`serializeEditor`, `isAtEditorStart`) and keep component tests for the deterministic paths only.
