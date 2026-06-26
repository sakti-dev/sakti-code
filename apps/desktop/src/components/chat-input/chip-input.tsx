import { createSignal, type JSX, onMount, Show } from "solid-js";
import { cn } from "~/lib/utils";
import {
  createChipElement,
  isAtEditorStart,
  serializeEditor,
} from "./chip-model";

export interface ChipTrigger {
  char: "/" | "@";
}

export interface ChipInputApi {
  clear: () => void;
  focus: () => void;
  insertChip: (token: string) => void;
}

export interface ChipInputProps {
  class?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  onTrigger?: (t: ChipTrigger) => void;
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

export function ChipInput(props: ChipInputProps): JSX.Element {
  let editorRef: HTMLDivElement | undefined;
  const [empty, setEmpty] = createSignal(true);
  // IME composition guard — suppress key handling mid-composition.
  let composing = false;
  // Caret bookmark captured when a trigger char is typed; consumed by insertChip.
  let pendingTrigger: Range | null = null;

  const emit = () => {
    if (!editorRef) {
      return;
    }
    const text = serializeEditor(editorRef);
    setEmpty(text.length === 0 && editorRef.childNodes.length === 0);
    // Any free-form input invalidates a pending trigger bookmark.
    pendingTrigger = null;
    props.onChange(text);
  };

  const insertChip = (token: string) => {
    const ed = editorRef;
    if (!ed) {
      return;
    }
    const chip = createChipElement(token);
    // A trailing space gives the caret a text node to anchor to (a caret set
    // directly after a contenteditable=false element at the end of the editor
    // is unreliable in browsers) and matches the prior `${token} ` UX.
    const spacer = document.createTextNode(" ");
    const bookmark = pendingTrigger;
    if (bookmark) {
      // Real browser: insert at the saved caret.
      bookmark.insertNode(chip);
      chip.after(spacer);
    } else {
      // No saved caret (e.g. programmatic insert / jsdom): append at the end.
      ed.appendChild(chip);
      ed.appendChild(spacer);
    }
    pendingTrigger = null;
    // Focus BEFORE placing the caret — focusing a contenteditable can reset a
    // selection that was set while the editor was unfocused (the menu input
    // had focus during the pick).
    ed.focus();
    const sel = window.getSelection();
    if (sel) {
      const after = document.createRange();
      after.setStartAfter(spacer);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
    }
    const text = serializeEditor(ed);
    setEmpty(false);
    props.onChange(text);
  };

  const api: ChipInputApi = {
    clear: () => {
      if (editorRef) {
        editorRef.textContent = "";
        pendingTrigger = null;
        emit();
      }
    },
    focus: () => editorRef?.focus(),
    insertChip,
  };

  onMount(() => {
    props.registerApi?.(api);
  });

  const onKeyDown = (e: KeyboardEvent) => {
    if (composing) {
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      props.onSubmit?.();
      return;
    }
    // Trigger detection: "/" only at the editor start, "@" anywhere.
    // preventDefault so the char never enters the DOM — insertChip owns the
    // mutation against the saved caret bookmark (simpler Range math).
    if (e.key === "/" && editorRef && isAtEditorStart(editorRef)) {
      e.preventDefault();
      pendingTrigger = saveCaret();
      props.onTrigger?.({ char: "/" });
    } else if (e.key === "@") {
      e.preventDefault();
      pendingTrigger = saveCaret();
      props.onTrigger?.({ char: "@" });
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
      {/* biome-ignore lint/a11y/useSemanticElements: contenteditable host holds inline chip spans; <textarea> cannot */}
      <div
        aria-multiline="true"
        class={cn(
          "scrollbar-default w-full resize-none bg-transparent px-1 py-2 outline-none",
          "max-h-[200px] min-h-6 overflow-y-auto whitespace-pre-wrap break-words",
          "text-foreground",
          props.class
        )}
        contenteditable={props.disabled ? "false" : "true"}
        data-component="chip-input"
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
          // Force plain-text paste (strip HTML, keep text + newlines).
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
