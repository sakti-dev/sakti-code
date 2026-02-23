import { ChatInput } from "@/views/workspace-view/chat-area/input/chat-input";
import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
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
    ({ unmount: dispose } = render(() => <ChatInput placeholder="Custom placeholder" />, {
      container,
    }));

    const textarea = container.querySelector("textarea");
    expect(textarea?.getAttribute("placeholder")).toBe("Custom placeholder");
    expect(container.textContent).toContain("0 chars");
  });

  it("calls onValueChange when user types", () => {
    const onValueChange = vi.fn();

    ({ unmount: dispose } = render(() => <ChatInput onValueChange={onValueChange} />, {
      container,
    }));

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "Hello";
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));

    expect(onValueChange).toHaveBeenCalledWith("Hello");
  });

  it("submits on Enter without Shift", () => {
    const onSend = vi.fn();

    ({ unmount: dispose } = render(() => <ChatInput value="Hello" onSend={onSend} />, {
      container,
    }));

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("does not submit on Shift+Enter", () => {
    const onSend = vi.fn();

    ({ unmount: dispose } = render(() => <ChatInput value="Hello" onSend={onSend} />, {
      container,
    }));

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true })
    );
    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables send action while isSending is true", () => {
    const onSend = vi.fn();

    ({ unmount: dispose } = render(
      () => <ChatInput value="Hello" onSend={onSend} isSending={true} />,
      { container }
    ));

    const send = container.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("renders pending permission strip above input", () => {
    ({ unmount: dispose } = render(
      () => (
        <ChatInput
          pendingPermission={{
            id: "perm-1",
            toolName: "write",
            description: "Needs file write access",
            patterns: ["src/**"],
          }}
        />
      ),
      { container }
    ));

    const strip = container.querySelector('[data-component="permission-input-strip"]');
    expect(strip).not.toBeNull();
    expect(container.textContent).toContain("Permission required");
    expect(container.textContent).toContain("write");
    expect(container.textContent).toContain("Needs file write access");
    expect(container.textContent).toContain("src/**");
  });

  it("calls permission callbacks from strip actions", () => {
    const onApproveOnce = vi.fn();
    const onApproveAlways = vi.fn();
    const onDeny = vi.fn();

    ({ unmount: dispose } = render(
      () => (
        <ChatInput
          pendingPermission={{
            id: "perm-2",
            toolName: "bash",
            patterns: ["packages/**", "apps/**"],
          }}
          onPermissionApproveOnce={onApproveOnce}
          onPermissionApproveAlways={onApproveAlways}
          onPermissionDeny={onDeny}
        />
      ),
      { container }
    ));

    const approveOnce = container.querySelector(
      'button[data-action="permission-approve-once"]'
    ) as HTMLButtonElement;
    const approveAlways = container.querySelector(
      'button[data-action="permission-approve-always"]'
    ) as HTMLButtonElement;
    const deny = container.querySelector(
      'button[data-action="permission-deny"]'
    ) as HTMLButtonElement;

    approveOnce.click();
    approveAlways.click();
    deny.click();

    expect(onApproveOnce).toHaveBeenCalledWith("perm-2");
    expect(onApproveAlways).toHaveBeenCalledWith("perm-2", ["packages/**", "apps/**"]);
    expect(onDeny).toHaveBeenCalledWith("perm-2");
  });

  it("disables permission actions while resolving", () => {
    const onApproveOnce = vi.fn();

    ({ unmount: dispose } = render(
      () => (
        <ChatInput
          pendingPermission={{
            id: "perm-3",
            toolName: "write",
            patterns: [],
          }}
          onPermissionApproveOnce={onApproveOnce}
          isResolvingPermission={true}
        />
      ),
      { container }
    ));

    const approveOnce = container.querySelector(
      'button[data-action="permission-approve-once"]'
    ) as HTMLButtonElement;
    const approveAlways = container.querySelector(
      'button[data-action="permission-approve-always"]'
    ) as HTMLButtonElement;
    const deny = container.querySelector(
      'button[data-action="permission-deny"]'
    ) as HTMLButtonElement;

    expect(approveOnce.disabled).toBe(true);
    expect(approveAlways.disabled).toBe(true);
    expect(deny.disabled).toBe(true);
    approveOnce.click();
    expect(onApproveOnce).not.toHaveBeenCalled();
  });

  it("calls onModeChange when toggling mode", () => {
    const onModeChange = vi.fn();
    const [mode, setMode] = createSignal<"plan" | "build">("plan");

    ({ unmount: dispose } = render(
      () => (
        <ChatInput
          mode={mode()}
          onModeChange={next => {
            onModeChange(next);
            setMode(next);
          }}
        />
      ),
      { container }
    ));

    const toggle = container.querySelector('button[title^="Switch to"]') as HTMLButtonElement;
    toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onModeChange).toHaveBeenCalledWith("build");
  });

  it("shows provider-grouped model command center with header and hints", () => {
    ({ unmount: dispose } = render(
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
      { container }
    ));

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

  it("filters model results by search query", async () => {
    const modelOptions = [
      { id: "zai/glm-4.7", providerId: "zai", name: "GLM 4.7", connected: true },
      { id: "zai/glm-4.6", providerId: "zai", name: "GLM 4.6", connected: true },
      {
        id: "openai/gpt-4o-mini",
        providerId: "openai",
        name: "GPT-4o mini",
        connected: false,
      },
    ];

    const getModelSections = vi.fn((query: string) => {
      const filtered = query
        ? modelOptions.filter(m =>
            `${m.id} ${m.name ?? ""} ${m.providerId}`.toLowerCase().includes(query.toLowerCase())
          )
        : modelOptions;

      const map = new Map();
      for (const model of filtered) {
        const existing = map.get(model.providerId);
        if (existing) {
          existing.models.push(model);
        } else {
          map.set(model.providerId, {
            providerId: model.providerId,
            providerName: model.providerId,
            connected: model.connected,
            models: [model],
          });
        }
      }
      return Array.from(map.values());
    });

    ({ unmount: dispose } = render(
      () => (
        <ChatInput
          selectedModel="zai/glm-4.7"
          modelOptions={modelOptions}
          getModelSections={getModelSections}
        />
      ),
      { container }
    ));

    const modelButton = container.querySelector(
      'button[aria-label="Open model selector"]'
    ) as HTMLButtonElement;
    modelButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Wait for dialog to open and render
    await new Promise(resolve => setTimeout(resolve, 100));

    const searchInput = document.body.querySelector(
      'input[aria-label="Search models"]'
    ) as HTMLInputElement;

    // Properly trigger input change
    searchInput.focus();
    searchInput.value = "gpt";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));

    // Wait for reactive updates to flush
    await new Promise(resolve => setTimeout(resolve, 100));

    const options = Array.from(document.body.querySelectorAll('[role="option"]')).map(
      option => option.textContent ?? ""
    );
    expect(options).not.toContain("GLM 4.7");
    expect(options.some(option => option.includes("GPT-4o mini"))).toBe(true);
  });

  it("supports keyboard navigation and enter to pick model", async () => {
    const onModelChange = vi.fn();
    const modelOptions = [
      { id: "zai/glm-4.7", providerId: "zai", name: "GLM 4.7", connected: true },
      { id: "zai/glm-4.6", providerId: "zai", name: "GLM 4.6", connected: true },
      {
        id: "openai/gpt-4o-mini",
        providerId: "openai",
        name: "GPT-4o mini",
        connected: false,
      },
    ];

    const getModelSections = vi.fn(() => {
      const map = new Map();
      for (const model of modelOptions) {
        const existing = map.get(model.providerId);
        if (existing) {
          existing.models.push(model);
        } else {
          map.set(model.providerId, {
            providerId: model.providerId,
            providerName: model.providerId,
            connected: model.connected,
            models: [model],
          });
        }
      }
      return Array.from(map.values());
    });

    ({ unmount: dispose } = render(
      () => (
        <ChatInput
          selectedModel="zai/glm-4.7"
          onModelChange={onModelChange}
          modelOptions={modelOptions}
          getModelSections={getModelSections}
        />
      ),
      { container }
    ));

    const modelButton = container.querySelector(
      'button[aria-label="Open model selector"]'
    ) as HTMLButtonElement;
    modelButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Wait for dialog to open and render
    await new Promise(resolve => setTimeout(resolve, 100));

    const searchInput = document.body.querySelector(
      'input[aria-label="Search models"]'
    ) as HTMLInputElement;

    // Focus the input and dispatch keyboard events
    searchInput.focus();
    await new Promise(resolve => setTimeout(resolve, 50));

    searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 50));

    searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(onModelChange).toHaveBeenCalledWith("zai/glm-4.6");
  });

  it("picks a model via mouse click", () => {
    const onModelChange = vi.fn();

    ({ unmount: dispose } = render(
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
      { container }
    ));

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

    ({ unmount: dispose } = render(
      () => (
        <ChatInput
          selectedModel="zai/glm-4.7"
          getModelSections={getModelSections}
          modelOptions={[
            { id: "zai/glm-4.7", providerId: "zai", name: "GLM 4.7", connected: true },
          ]}
        />
      ),
      { container }
    ));

    expect(getModelSections).not.toHaveBeenCalled();

    const modelButton = container.querySelector(
      'button[aria-label="Open model selector"]'
    ) as HTMLButtonElement;
    modelButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(getModelSections).toHaveBeenCalled();
  });

  it("autofocuses context search and shows file results without legacy context commands", async () => {
    const getFileSearchResults = vi.fn(async (query: string) => {
      if (!query.trim()) return [];
      return [
        {
          path: `src/${query}.ts`,
          name: `${query}.ts`,
          score: 1,
          type: "file" as const,
        },
      ];
    });

    ({ unmount: dispose } = render(
      () => (
        <ChatInput
          getFileSearchResults={getFileSearchResults}
          modelOptions={[
            { id: "zai/glm-4.7", providerId: "zai", name: "GLM 4.7", connected: true },
          ]}
        />
      ),
      { container }
    ));

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "@observer";
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));

    await new Promise(resolve => setTimeout(resolve, 80));

    const searchInput = document.body.querySelector(
      'input[aria-label="Search models"]'
    ) as HTMLInputElement;
    expect(searchInput).toBeTruthy();
    expect(document.activeElement).toBe(searchInput);

    await new Promise(resolve => setTimeout(resolve, 20));

    expect(document.body.textContent).toContain("Adding context");
    expect(document.body.textContent).toContain("observer.ts");
    expect(document.body.textContent).not.toContain("Add File Context");
    expect(document.body.textContent).not.toContain("Add Symbol Context");
    expect(getFileSearchResults).toHaveBeenCalled();
  });

  it("inserts selected directory mention into input", async () => {
    const onValueChange = vi.fn();
    const getFileSearchResults = vi.fn(async () => [
      {
        path: "/workspace/src/components",
        name: "components",
        score: 10,
        type: "directory" as const,
      },
    ]);

    ({ unmount: dispose } = render(
      () => (
        <ChatInput
          onValueChange={onValueChange}
          getFileSearchResults={getFileSearchResults}
          modelOptions={[
            { id: "zai/glm-4.7", providerId: "zai", name: "GLM 4.7", connected: true },
          ]}
        />
      ),
      { container }
    ));

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "@comp";
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));

    await new Promise(resolve => setTimeout(resolve, 80));

    const option = Array.from(document.body.querySelectorAll('[role="option"]')).find(node =>
      (node.textContent ?? "").includes("components")
    ) as HTMLButtonElement | undefined;
    expect(option).toBeTruthy();

    option?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onValueChange).toHaveBeenCalledWith("@/workspace/src/components ");
  });
});
