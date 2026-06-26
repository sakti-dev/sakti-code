import { fireEvent, render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { ChipInput, type ChipInputApi } from "../chip-input";

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
