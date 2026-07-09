import { createSignal, type JSX, onMount, Show } from "solid-js";
import { cn } from "~/lib/utils";
import { createChipElement, isAtEditorEnd, isAtEditorStart, serializeEditor } from "./chip-model";

export interface ChipTrigger {
  char: "/" | "@";
}

export interface ChipInputApi {
  clear: () => void;
  focus: () => void;
  replaceTokenWithChip: (token: string) => void;
  setText: (text: string) => void;
}

export interface ChipInputProps {
  class?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  onTrigger?: (t: ChipTrigger) => void;
  /** Live query text after a trigger char; null closes the active token. */
  onQuery?: (query: string | null) => void;
  /** Forwards ArrowUp/ArrowDown/Enter/Escape while a token is active. */
  onMenuKeyDown?: (e: KeyboardEvent) => void;
  /** ArrowUp at editor start / ArrowDown at editor end (no token active). */
  onHistoryNavigate?: (dir: "up" | "down") => void;
  /** When true, ArrowUp/ArrowDown navigate history regardless of caret. */
  historyActive?: () => boolean;
  placeholder?: string;
  registerApi?: (api: ChipInputApi) => void;
}

/** Snapshot the current selection as a Range, or null when unavailable. */
function saveCaret(): Range | null {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    return sel.getRangeAt(0).cloneRange();
  }
  return null;
}

const MENU_KEYS = new Set(["ArrowDown", "ArrowUp", "Enter", "Escape"]);

export function ChipInput(props: ChipInputProps): JSX.Element {
  let editorRef: HTMLDivElement | undefined;
  const [empty, setEmpty] = createSignal(true);
  // IME composition guard — suppress key handling mid-composition.
  let composing = false;
  // Collapsed Range recorded just BEFORE the trigger char is inserted. The
  // live query is the text between this anchor and the caret; replaceTokenWith
  // Chip deletes that span and drops the chip in its place.
  let tokenAnchor: Range | null = null;

  const emit = () => {
    if (!editorRef) {
      return;
    }
    const text = serializeEditor(editorRef);
    setEmpty(text.length === 0 && editorRef.childNodes.length === 0);
    props.onChange(text);
    computeQuery();
  };

  // Derive the live query from tokenAnchor → caret. Closes (onQuery null) when
  // the token contains whitespace or the trigger char was deleted.
  const computeQuery = () => {
    if (!editorRef || !tokenAnchor) {
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      return;
    }
    const caret = sel.getRangeAt(0);
    const span = tokenAnchor.cloneRange();
    try {
      span.setEnd(caret.startContainer, caret.startOffset);
    } catch {
      return;
    }
    const text = span.toString();
    if (text.length === 0) {
      endToken();
      return;
    }
    const query = text.slice(1);
    if (/\s/.test(query)) {
      endToken();
      return;
    }
    props.onQuery?.(query);
  };

  const endToken = () => {
    tokenAnchor = null;
    props.onQuery?.(null);
  };

  /** Insert the trigger char at the caret and record the token anchor. */
  const beginToken = (char: "/" | "@") => {
    tokenAnchor = saveCaret();
    insertTextAtCaret(char);
    props.onTrigger?.({ char });
    emit();
  };

  const insertTextAtCaret = (text: string) => {
    const ed = editorRef;
    if (!ed) {
      return;
    }
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && ed.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.setEndAfter(node);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      ed.appendChild(document.createTextNode(text));
    }
  };

  const replaceTokenWithChip = (token: string) => {
    const ed = editorRef;
    if (!ed) {
      return;
    }
    const chip = createChipElement(token);
    const spacer = document.createTextNode(" ");
    const anchor = tokenAnchor;
    tokenAnchor = null;
    if (anchor) {
      const sel = window.getSelection();
      const range = anchor.cloneRange();
      if (sel && sel.rangeCount > 0) {
        range.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
      }
      try {
        range.deleteContents();
        range.insertNode(chip);
      } catch {
        ed.appendChild(chip);
      }
      chip.after(spacer);
    } else {
      ed.appendChild(chip);
      ed.appendChild(spacer);
    }
    const text = serializeEditor(ed);
    setEmpty(false);
    props.onChange(text);
    requestAnimationFrame(() => {
      // Bail if the editor was unmounted (e.g. component torn down between
      // the pick and the next animation frame, as in jsdom test cleanup).
      if (!spacer.parentNode) {
        return;
      }
      const sel = window.getSelection();
      if (!sel) {
        return;
      }
      const after = document.createRange();
      after.setStartAfter(spacer);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
      ed.focus();
    });
  };

  const api: ChipInputApi = {
    clear: () => {
      if (editorRef) {
        editorRef.textContent = "";
        tokenAnchor = null;
        emit();
      }
    },
    focus: () => editorRef?.focus(),
    replaceTokenWithChip,
    setText: (text: string) => {
      const ed = editorRef;
      if (!ed) {
        return;
      }
      ed.textContent = text;
      tokenAnchor = null;
      ed.focus();
      const range = document.createRange();
      range.selectNodeContents(ed);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      emit();
    },
  };

  onMount(() => {
    props.registerApi?.(api);
  });

  const onKeyDown = (e: KeyboardEvent) => {
    if (composing) {
      return;
    }
    if (tokenAnchor && MENU_KEYS.has(e.key)) {
      e.preventDefault();
      props.onMenuKeyDown?.(e);
      if (e.key === "Escape") {
        endToken();
      }
      return;
    }
    if (!tokenAnchor && editorRef && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const active = props.historyActive?.() ?? false;
      if (e.key === "ArrowUp" && (active || isAtEditorStart(editorRef))) {
        e.preventDefault();
        props.onHistoryNavigate?.("up");
        return;
      }
      if (e.key === "ArrowDown" && (active || isAtEditorEnd(editorRef))) {
        e.preventDefault();
        props.onHistoryNavigate?.("down");
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      props.onSubmit?.();
      return;
    }
    if (e.key === "/" && editorRef && isAtEditorStart(editorRef)) {
      e.preventDefault();
      beginToken("/");
    } else if (e.key === "@") {
      e.preventDefault();
      beginToken("@");
    }
  };

  return (
    <div class="relative">
      <Show when={empty() && props.placeholder}>
        <div class="pointer-events-none absolute inset-0 px-1 py-2 text-muted-foreground/60">
          {props.placeholder}
        </div>
      </Show>
      {/* biome-ignore lint/a11y/useSemanticElements: contenteditable host holds inline chip spans; <textarea> cannot */}
      <div
        aria-multiline="true"
        class={cn(
          "scrollbar-default w-full resize-none bg-transparent px-1 py-2 outline-none",
          "max-h-[200px] min-h-6 overflow-y-auto whitespace-pre-wrap break-words",
          "text-foreground",
          props.class,
        )}
        contenteditable={props.disabled ? "false" : "true"}
        data-component="chip-input"
        onBlur={() => endToken()}
        onCompositionEnd={() => {
          composing = false;
          emit();
        }}
        onCompositionStart={() => {
          composing = true;
        }}
        onInput={emit}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData?.getData("text/plain") ?? "";
          document.execCommand("insertText", false, text);
        }}
        ref={(el: HTMLDivElement) => {
          editorRef = el;
        }}
        role="textbox"
        tabIndex={0}
      />
    </div>
  );
}
