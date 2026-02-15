import { ChatInput } from "@/views/workspace-view/chat-area/chat-input";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("ChatInput", () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    dispose?.();
    document.body.removeChild(container);
  });

  it("renders with placeholder and character count", () => {
    dispose = render(() => <ChatInput placeholder="Custom placeholder" />, container);

    const textarea = container.querySelector("textarea");
    expect(textarea?.getAttribute("placeholder")).toBe("Custom placeholder");
    expect(container.textContent).toContain("0 chars");
  });

  it("calls onValueChange when user types", () => {
    const onValueChange = vi.fn();

    dispose = render(() => <ChatInput onValueChange={onValueChange} />, container);

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "Hello";
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));

    expect(onValueChange).toHaveBeenCalledWith("Hello");
  });

  it("submits on Enter without Shift", () => {
    const onSend = vi.fn();

    dispose = render(() => <ChatInput value="Hello" onSend={onSend} />, container);

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("does not submit on Shift+Enter", () => {
    const onSend = vi.fn();

    dispose = render(() => <ChatInput value="Hello" onSend={onSend} />, container);

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true })
    );

    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables send action while isSending is true", () => {
    const onSend = vi.fn();

    dispose = render(() => <ChatInput value="Hello" onSend={onSend} isSending={true} />, container);

    const send = container.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("calls onModeChange when toggling mode", () => {
    const onModeChange = vi.fn();
    const [mode, setMode] = createSignal<"plan" | "build">("plan");

    dispose = render(
      () => (
        <ChatInput
          mode={mode()}
          onModeChange={next => {
            onModeChange(next);
            setMode(next);
          }}
        />
      ),
      container
    );

    const toggle = container.querySelector('button[title^="Switch to"]') as HTMLButtonElement;
    toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onModeChange).toHaveBeenCalledWith("build");
  });

  it("shows provider-grouped model command center with header and hints", () => {
    dispose = render(
      () => (
        <ChatInput
          selectedModel="zai/glm-4.7"
          getModelSections={() => [
            {
              providerId: "zai",
              providerName: "Z.AI",
              connected: true,
              models: [{ id: "zai/glm-4.7", providerId: "zai", name: "GLM 4.7", connected: true }],
            },
            {
              providerId: "openai",
              providerName: "OpenAI",
              connected: false,
              models: [
                {
                  id: "openai/gpt-4o-mini",
                  providerId: "openai",
                  name: "GPT-4o mini",
                  connected: false,
                },
              ],
            },
          ]}
          modelOptions={[
            { id: "zai/glm-4.7", providerId: "zai", name: "GLM 4.7", connected: true },
            {
              id: "openai/gpt-4o-mini",
              providerId: "openai",
              name: "GPT-4o mini",
              connected: false,
            },
          ]}
        />
      ),
      container
    );

    const modelButton = container.querySelector(
      'button[aria-label="Open model selector"]'
    ) as HTMLButtonElement;
    modelButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.body.textContent).toContain("Selecting model");
    expect(document.body.textContent).toContain("/model");
    expect(document.body.textContent).toContain("Z.AI");
    expect(document.body.textContent).toContain("OpenAI");
    expect(document.body.textContent).toContain("Enter");
    expect(document.body.textContent).toContain("Navigate");
    expect(container.textContent).toContain("Connected / Not Connected");
  });

  it("filters model results by search query", () => {
    dispose = render(
      () => (
        <ChatInput
          selectedModel="zai/glm-4.7"
          modelOptions={[
            { id: "zai/glm-4.7", providerId: "zai", name: "GLM 4.7", connected: true },
            { id: "zai/glm-4.6", providerId: "zai", name: "GLM 4.6", connected: true },
            {
              id: "openai/gpt-4o-mini",
              providerId: "openai",
              name: "GPT-4o mini",
              connected: false,
            },
          ]}
        />
      ),
      container
    );

    const modelButton = container.querySelector(
      'button[aria-label="Open model selector"]'
    ) as HTMLButtonElement;
    modelButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const searchInput = document.body.querySelector(
      'input[aria-label="Search models"]'
    ) as HTMLInputElement;
    searchInput.value = "gpt";
    searchInput.dispatchEvent(new InputEvent("input", { bubbles: true }));

    const options = Array.from(document.body.querySelectorAll('[role="option"]')).map(
      option => option.textContent ?? ""
    );
    expect(options).not.toContain("GLM 4.7");
    expect(options.some(option => option.includes("GPT-4o mini"))).toBe(true);
  });

  it("supports keyboard navigation and enter to pick model", () => {
    const onModelChange = vi.fn();

    dispose = render(
      () => (
        <ChatInput
          selectedModel="zai/glm-4.7"
          onModelChange={onModelChange}
          modelOptions={[
            { id: "zai/glm-4.7", providerId: "zai", name: "GLM 4.7", connected: true },
            { id: "zai/glm-4.6", providerId: "zai", name: "GLM 4.6", connected: true },
            {
              id: "openai/gpt-4o-mini",
              providerId: "openai",
              name: "GPT-4o mini",
              connected: false,
            },
          ]}
        />
      ),
      container
    );

    const modelButton = container.querySelector(
      'button[aria-label="Open model selector"]'
    ) as HTMLButtonElement;
    modelButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const searchInput = document.body.querySelector(
      'input[aria-label="Search models"]'
    ) as HTMLInputElement;
    searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onModelChange).toHaveBeenCalledWith("zai/glm-4.6");
  });

  it("picks a model via mouse click", () => {
    const onModelChange = vi.fn();

    dispose = render(
      () => (
        <ChatInput
          selectedModel="zai/glm-4.7"
          onModelChange={onModelChange}
          getModelSections={() => [
            {
              providerId: "zai",
              providerName: "Z.AI",
              connected: true,
              models: [{ id: "zai/glm-4.7", providerId: "zai", name: "GLM 4.7", connected: true }],
            },
            {
              providerId: "openai",
              providerName: "OpenAI",
              connected: true,
              models: [
                {
                  id: "openai/gpt-4o-mini",
                  providerId: "openai",
                  name: "GPT-4o mini",
                  connected: true,
                },
              ],
            },
          ]}
          modelOptions={[
            { id: "zai/glm-4.7", providerId: "zai", name: "GLM 4.7", connected: true },
            {
              id: "openai/gpt-4o-mini",
              providerId: "openai",
              name: "GPT-4o mini",
              connected: true,
            },
          ]}
        />
      ),
      container
    );

    const modelButton = container.querySelector(
      'button[aria-label="Open model selector"]'
    ) as HTMLButtonElement;
    modelButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const option = Array.from(document.body.querySelectorAll('[role="option"]')).find(node =>
      (node.textContent ?? "").includes("GPT-4o mini")
    ) as HTMLButtonElement | undefined;
    expect(option).toBeTruthy();

    option?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onModelChange).toHaveBeenCalledWith("openai/gpt-4o-mini");
  });

  it("does not compute model sections until selector is opened", () => {
    const getModelSections = vi.fn(() => [
      {
        providerId: "zai",
        providerName: "Z.AI",
        connected: true,
        models: [{ id: "zai/glm-4.7", providerId: "zai", name: "GLM 4.7", connected: true }],
      },
    ]);

    dispose = render(
      () => (
        <ChatInput
          selectedModel="zai/glm-4.7"
          getModelSections={getModelSections}
          modelOptions={[
            { id: "zai/glm-4.7", providerId: "zai", name: "GLM 4.7", connected: true },
          ]}
        />
      ),
      container
    );

    expect(getModelSections).not.toHaveBeenCalled();

    const modelButton = container.querySelector(
      'button[aria-label="Open model selector"]'
    ) as HTMLButtonElement;
    modelButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(getModelSections).toHaveBeenCalled();
  });
});
