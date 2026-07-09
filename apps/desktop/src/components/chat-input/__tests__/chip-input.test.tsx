import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vite-plus/test";
import { ChipInput, type ChipInputApi } from "../chip-input";
import { serializeEditor } from "../chip-model";

function caretAtStart(editor: HTMLElement) {
  editor.focus();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function caretAtEnd(editor: HTMLElement) {
  editor.focus();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function typeText(editor: HTMLElement, text: string) {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.setEndAfter(node);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    editor.appendChild(document.createTextNode(text));
  }
  fireEvent.input(editor);
}

describe("ChipInput", () => {
  it("emits the typed text via onChange", () => {
    const onChange = vi.fn();
    render(() => <ChipInput onChange={onChange} />);
    const ed = screen.getByRole("textbox") as HTMLElement;
    ed.textContent = "hello";
    fireEvent.input(ed);
    expect(onChange).toHaveBeenLastCalledWith("hello");
  });

  it("calls onSubmit on Enter (without shift) when no menu is active", () => {
    const onSubmit = vi.fn();
    render(() => <ChipInput onChange={() => {}} onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does NOT submit on Shift+Enter", () => {
    const onSubmit = vi.fn();
    render(() => <ChipInput onChange={() => {}} onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the placeholder only when empty", () => {
    render(() => <ChipInput onChange={() => {}} placeholder="Send a message…" />);
    expect(screen.queryByText("Send a message…")).not.toBeNull();
    const ed = screen.getByRole("textbox");
    ed.textContent = "x";
    fireEvent.input(ed);
    expect(screen.queryByText("Send a message…")).toBeNull();
  });

  it("exposes clear() and focus() via registerApi", () => {
    let api: ChipInputApi | undefined;
    const onChange = vi.fn();
    render(() => <ChipInput onChange={onChange} registerApi={(a) => (api = a)} />);
    const ed = screen.getByRole("textbox");
    ed.textContent = "stuff";
    fireEvent.input(ed);
    api?.clear();
    expect(ed.textContent).toBe("");
    expect(onChange).toHaveBeenLastCalledWith("");
  });
});

describe("ChipInput triggers + live query", () => {
  it("fires onTrigger for / typed at the editor start and lets the char enter the DOM", () => {
    const onChange = vi.fn();
    const onTrigger = vi.fn();
    const onQuery = vi.fn();
    render(() => (
      <ChipInput
        onChange={onChange}
        onTrigger={onTrigger}
        onQuery={onQuery}
        placeholder="Send a message…"
      />
    ));
    const ed = screen.getByRole("textbox") as HTMLElement;
    caretAtStart(ed);
    fireEvent.keyDown(ed, { key: "/" });
    expect(onTrigger).toHaveBeenCalledWith({ char: "/" });
    expect(onChange).toHaveBeenLastCalledWith("/");
    expect(onQuery).toHaveBeenCalledWith("");
    expect(ed.textContent).toBe("/");
    expect(screen.queryByText("Send a message…")).toBeNull();
  });

  it("does NOT fire onTrigger for / typed after other content", () => {
    const onTrigger = vi.fn();
    render(() => <ChipInput onChange={() => {}} onTrigger={onTrigger} />);
    const ed = screen.getByRole("textbox");
    ed.textContent = "ab";
    fireEvent.input(ed);
    caretAtEnd(ed);
    fireEvent.keyDown(ed, { key: "/" });
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("fires onTrigger for @ at any position", () => {
    const onTrigger = vi.fn();
    const onQuery = vi.fn();
    render(() => <ChipInput onChange={() => {}} onTrigger={onTrigger} onQuery={onQuery} />);
    const ed = screen.getByRole("textbox") as HTMLElement;
    ed.textContent = "fix ";
    fireEvent.input(ed);
    caretAtEnd(ed);
    fireEvent.keyDown(ed, { key: "@" });
    expect(onTrigger).toHaveBeenCalledWith({ char: "@" });
    expect(ed.textContent).toContain("@");
  });

  it("emits the live query as the user types after the trigger", () => {
    const onQuery = vi.fn();
    render(() => <ChipInput onChange={() => {}} onQuery={onQuery} />);
    const ed = screen.getByRole("textbox") as HTMLElement;
    caretAtStart(ed);
    fireEvent.keyDown(ed, { key: "@" });
    onQuery.mockClear();
    typeText(ed, "pkg");
    expect(onQuery).toHaveBeenLastCalledWith("pkg");
  });

  it("closes the token (onQuery null) when a space follows the trigger and leaves the text", () => {
    const onQuery = vi.fn();
    render(() => <ChipInput onChange={() => {}} onQuery={onQuery} />);
    const ed = screen.getByRole("textbox") as HTMLElement;
    caretAtStart(ed);
    fireEvent.keyDown(ed, { key: "@" });
    onQuery.mockClear();
    typeText(ed, " ");
    expect(onQuery).toHaveBeenLastCalledWith(null);
    expect(ed.textContent).toContain("@");
  });

  it("forwards Arrow/Enter/Escape to onMenuKeyDown and does NOT submit while a token is active", () => {
    const onSubmit = vi.fn();
    const onMenuKeyDown = vi.fn();
    render(() => (
      <ChipInput
        onChange={() => {}}
        onSubmit={onSubmit}
        onQuery={vi.fn()}
        onMenuKeyDown={onMenuKeyDown}
      />
    ));
    const ed = screen.getByRole("textbox") as HTMLElement;
    caretAtStart(ed);
    fireEvent.keyDown(ed, { key: "@" });
    for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) {
      onMenuKeyDown.mockClear();
      onSubmit.mockClear();
      fireEvent.keyDown(ed, { key });
      expect(onMenuKeyDown).toHaveBeenCalledTimes(1);
      expect(onSubmit).not.toHaveBeenCalled();
    }
  });

  it("does not swallow Tab while a token is active", () => {
    const onMenuKeyDown = vi.fn();
    render(() => <ChipInput onChange={() => {}} onMenuKeyDown={onMenuKeyDown} />);
    const ed = screen.getByRole("textbox") as HTMLElement;
    caretAtStart(ed);
    fireEvent.keyDown(ed, { key: "@" });
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    ed.dispatchEvent(event);
    expect(onMenuKeyDown).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("replaceTokenWithChip swaps the typed token text for an atomic chip", () => {
    let api: ChipInputApi | undefined;
    const onChange = vi.fn();
    render(() => (
      <ChipInput onChange={onChange} registerApi={(a) => (api = a)} onQuery={vi.fn()} />
    ));
    const ed = screen.getByRole("textbox") as HTMLElement;
    caretAtStart(ed);
    fireEvent.keyDown(ed, { key: "@" });
    typeText(ed, "pk");
    api?.replaceTokenWithChip("@src/a.ts");
    expect(ed.querySelector('.chip[data-token="@src/a.ts"]')).toBeTruthy();
    expect(serializeEditor(ed)).toBe("@src/a.ts ");
    expect(ed.textContent).not.toMatch(/pk/);
  });

  it("replaceTokenWithChip falls back to appending when no token is active", () => {
    let api: ChipInputApi | undefined;
    const onChange = vi.fn();
    render(() => <ChipInput onChange={onChange} registerApi={(a) => (api = a)} />);
    const ed = screen.getByRole("textbox");
    ed.textContent = "fix ";
    fireEvent.input(ed);
    api?.replaceTokenWithChip("@src/a.ts");
    expect(serializeEditor(ed)).toBe("fix @src/a.ts ");
    expect(onChange).toHaveBeenLastCalledWith("fix @src/a.ts ");
  });
});
