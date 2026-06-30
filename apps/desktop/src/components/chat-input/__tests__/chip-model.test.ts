import { describe, expect, it } from "vite-plus/test";
import {
  chipKind,
  createChipElement,
  isAtEditorStart,
  isPointAtEditorStart,
  serializeEditor,
} from "../chip-model";

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

  it("tags the chip kind from the token prefix", () => {
    expect(createChipElement("/commit").dataset.chipKind).toBe("command");
    expect(createChipElement("skill:graphify").dataset.chipKind).toBe("skill");
    expect(createChipElement("@src/a.ts").dataset.chipKind).toBe("file");
  });
});

describe("chipKind", () => {
  it("classifies / tokens as command", () => {
    expect(chipKind("/commit")).toBe("command");
  });
  it("classifies skill: tokens as skill", () => {
    expect(chipKind("skill:graphify")).toBe("skill");
  });
  it("classifies @ tokens as file", () => {
    expect(chipKind("@src/a.ts")).toBe("file");
  });
  it("defaults unknown tokens to file", () => {
    expect(chipKind("plain")).toBe("file");
  });
});

describe("isPointAtEditorStart", () => {
  it("is true when the point is before all content", () => {
    const ed = editorWith("hello");
    expect(isPointAtEditorStart(ed, ed.firstChild as Text, 0)).toBe(true);
  });

  it("is false when the point is after some text", () => {
    const ed = editorWith("hello");
    expect(isPointAtEditorStart(ed, ed.firstChild as Text, 3)).toBe(false);
  });

  it("is true for a point directly on the editor at offset 0", () => {
    const ed = editorWith("hello");
    expect(isPointAtEditorStart(ed, ed, 0)).toBe(true);
  });

  it("is false when a chip precedes the caret", () => {
    const ed = editorWith(
      '<span class="chip" contenteditable="false" data-token="/x">/x</span>tail',
    );
    // Caret at offset 0 of the trailing text node → a chip precedes it.
    const tail = ed.childNodes[1] as Text;
    expect(isPointAtEditorStart(ed, tail, 0)).toBe(false);
  });

  it("is true at offset 0 of the first child when nothing precedes", () => {
    const ed = editorWith("ab");
    expect(isPointAtEditorStart(ed, ed.firstChild as Text, 0)).toBe(true);
  });
});

describe("isAtEditorStart", () => {
  it("is true for an empty editor (no selection in jsdom)", () => {
    const ed = editorWith("");
    expect(isAtEditorStart(ed)).toBe(true);
  });
});
