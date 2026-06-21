import { render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { AddProjectInput } from "../layout/add-project-input.tsx";

describe("AddProjectInput", () => {
  it("renders input with placeholder", () => {
    const { getByPlaceholderText } = render(() => (
      <AddProjectInput onAdd={vi.fn()} onCancel={vi.fn()} />
    ));
    expect(getByPlaceholderText("/path/to/project")).toBeTruthy();
  });

  it("calls onAdd with value on Enter", async () => {
    const onAdd = vi.fn();
    const { getByPlaceholderText } = render(() => (
      <AddProjectInput onAdd={onAdd} onCancel={vi.fn()} />
    ));
    const input = getByPlaceholderText("/path/to/project") as HTMLInputElement;
    input.value = "/my/project";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
    );
    expect(onAdd).toHaveBeenCalledWith("/my/project");
  });

  it("calls onCancel on Escape", async () => {
    const onCancel = vi.fn();
    const { getByPlaceholderText } = render(() => (
      <AddProjectInput onAdd={vi.fn()} onCancel={onCancel} />
    ));
    getByPlaceholderText("/path/to/project").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
    expect(onCancel).toHaveBeenCalled();
  });

  it("disables Add button when empty", () => {
    const { getByText } = render(() => (
      <AddProjectInput onAdd={vi.fn()} onCancel={vi.fn()} />
    ));
    const btn = getByText("Add") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
