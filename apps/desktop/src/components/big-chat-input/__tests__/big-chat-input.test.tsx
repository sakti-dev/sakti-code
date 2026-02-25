import { BigChatInput } from "@/components/big-chat-input/big-chat-input";
import { render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("BigChatInput", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders placeholder", () => {
    const { container } = render(() => (
      <BigChatInput placeholder="Research this repo" onSubmit={() => {}} />
    ));

    const textarea = container.querySelector("textarea");
    expect(textarea?.getAttribute("placeholder")).toBe("Research this repo");
  });

  it("submits on Enter", () => {
    const onSubmit = vi.fn();
    const { container } = render(() => <BigChatInput onSubmit={onSubmit} />);

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "Build a task plan";
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith("Build a task plan");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("ignores empty submit", () => {
    const onSubmit = vi.fn();
    const { container } = render(() => <BigChatInput onSubmit={onSubmit} />);

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "   ";
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
