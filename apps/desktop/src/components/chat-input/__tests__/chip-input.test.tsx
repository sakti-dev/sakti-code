import { fireEvent, render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vite-plus/test";
import { ChipInput, type ChipInputApi } from "../chip-input";
import { serializeEditor } from "../chip-model";

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
    const { getByRole } = render(() => (
      <ChipInput onChange={() => {}} onSubmit={onSubmit} />
    ));
    fireEvent.keyDown(getByRole("textbox"), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does NOT submit on Shift+Enter", () => {
    const onSubmit = vi.fn();
    const { getByRole } = render(() => (
      <ChipInput onChange={() => {}} onSubmit={onSubmit} />
    ));
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

describe("ChipInput triggers + chips", () => {
  it("fires onTrigger for / typed at the editor start", () => {
    const onTrigger = vi.fn();
    const { getByRole } = render(() => (
      <ChipInput onChange={() => {}} onTrigger={onTrigger} />
    ));
    fireEvent.keyDown(getByRole("textbox"), { key: "/" });
    expect(onTrigger).toHaveBeenCalledWith({ char: "/" });
  });

  it("does NOT fire onTrigger for / typed after other content", () => {
    const onTrigger = vi.fn();
    const { getByRole } = render(() => (
      <ChipInput onChange={() => {}} onTrigger={onTrigger} />
    ));
    const ed = getByRole("textbox");
    ed.textContent = "ab";
    fireEvent.input(ed);
    fireEvent.keyDown(ed, { key: "/" });
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("fires onTrigger for @ at any position", () => {
    const onTrigger = vi.fn();
    const { getByRole } = render(() => (
      <ChipInput onChange={() => {}} onTrigger={onTrigger} />
    ));
    const ed = getByRole("textbox");
    ed.textContent = "fix ";
    fireEvent.input(ed);
    fireEvent.keyDown(ed, { key: "@" });
    expect(onTrigger).toHaveBeenCalledWith({ char: "@" });
  });

  it("prevents the trigger char from entering the DOM", () => {
    const onTrigger = vi.fn();
    const { getByRole } = render(() => (
      <ChipInput onChange={() => {}} onTrigger={onTrigger} />
    ));
    const ed = getByRole("textbox");
    fireEvent.keyDown(ed, { key: "@" });
    expect(ed.textContent).toBe("");
  });

  it("insertChip inserts an atomic chip and emits its token", () => {
    let api: ChipInputApi | undefined;
    const onChange = vi.fn();
    const { getByRole } = render(() => (
      <ChipInput onChange={onChange} registerApi={(a) => (api = a)} />
    ));
    const ed = getByRole("textbox");
    // Trigger the menu (char is suppressed; bookmark saved).
    fireEvent.keyDown(ed, { key: "@" });
    api?.insertChip("@src/a.ts");
    expect(ed.querySelector('.chip[data-token="@src/a.ts"]')).toBeTruthy();
    // A trailing space is inserted after the chip to anchor the caret.
    expect(onChange).toHaveBeenLastCalledWith("@src/a.ts ");
  });

  it("insertChip falls back to appending at the end when no caret bookmark", () => {
    let api: ChipInputApi | undefined;
    const onChange = vi.fn();
    const { getByRole } = render(() => (
      <ChipInput onChange={onChange} registerApi={(a) => (api = a)} />
    ));
    const ed = getByRole("textbox");
    ed.textContent = "fix ";
    fireEvent.input(ed);
    // No trigger key fired → no bookmark → insertChip appends at end.
    api?.insertChip("@src/a.ts");
    expect(serializeEditor(ed)).toBe("fix @src/a.ts ");
    expect(onChange).toHaveBeenLastCalledWith("fix @src/a.ts ");
  });
});
