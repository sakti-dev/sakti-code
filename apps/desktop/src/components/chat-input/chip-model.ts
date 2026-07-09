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

export type ChipKind = "command" | "skill" | "file";

/** Derive the visual chip kind from the token prefix. */
export function chipKind(token: string): ChipKind {
  if (token.startsWith("/")) {
    return "command";
  }
  if (token.startsWith("skill:")) {
    return "skill";
  }
  return "file";
}

/** Visible chip label: command and skill chips are shown with a `/` prefix
 *  (`/commit`, `/skill:graphify`); files keep their `@`. The wire token in
 *  `data-token` is unchanged so the server preprocessor still receives
 *  `skill:graphify` / `@path`. */
export function chipLabel(token: string): string {
  const kind = chipKind(token);
  if (kind === "file") {
    return token;
  }
  return token.startsWith("/") ? token : `/${token}`;
}

/** Create an atomic chip span carrying the wire token. */
export function createChipElement(token: string): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.className = "chip";
  chip.dataset.token = token;
  chip.dataset.chipKind = chipKind(token);
  chip.textContent = chipLabel(token);
  return chip;
}

/** True if a caret point `(node, offset)` sits at the very beginning of `editor`. Pure. */
export function isPointAtEditorStart(editor: HTMLElement, node: Node, offset: number): boolean {
  // Point directly on the editor at offset 0 (before its first child).
  if (node === editor) {
    return offset === 0;
  }
  // Point inside a child: must be at offset 0, with nothing preceding its branch.
  if (offset !== 0) {
    return false;
  }
  let cur: Node | null = node;
  while (cur && cur !== editor) {
    if (cur.previousSibling) {
      return false;
    }
    cur = cur.parentNode;
  }
  return cur === editor;
}

/** True if the current selection starts at the very beginning of `editor`. */
export function isAtEditorStart(editor: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return editor.childNodes.length === 0;
  }
  const { startContainer: node, startOffset: offset } = sel.getRangeAt(0);
  return isPointAtEditorStart(editor, node, offset);
}

export function isPointAtEditorEnd(editor: HTMLElement, node: Node, offset: number): boolean {
  if (node === editor) {
    return offset === editor.childNodes.length;
  }
  const len =
    node.nodeType === Node.TEXT_NODE ? (node.textContent?.length ?? 0) : node.childNodes.length;
  if (offset !== len) {
    return false;
  }
  let cur: Node | null = node;
  while (cur && cur !== editor) {
    if (cur.nextSibling) {
      return false;
    }
    cur = cur.parentNode;
  }
  return cur === editor;
}

/** True if the collapsed caret sits at the very end of `editor`. */
export function isAtEditorEnd(editor: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return editor.childNodes.length === 0;
  }
  const range = sel.getRangeAt(0);
  if (!range.collapsed) {
    return false;
  }
  return isPointAtEditorEnd(editor, range.endContainer, range.endOffset);
}
