import { ModelSelector, type ModelSelectorSection } from "@/components/model-selector";
import { cleanup, render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

interface SlashCommand {
  id: string;
  trigger: string;
  title: string;
  description?: string;
  keybind?: string;
  type: "builtin" | "custom";
}

describe("ModelSelector command center", () => {
  let container: HTMLDivElement;
  let unmount: (() => void) | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    unmount?.();
    document.body.removeChild(container);
  });

  it("renders command mode with slash commands", () => {
    const slashCommands: SlashCommand[] = [
      { id: "session.new", trigger: "new", title: "New Session", type: "builtin" },
      { id: "session.undo", trigger: "undo", title: "Undo", type: "builtin" },
    ];

    const view = render(
      () => (
        <ModelSelector
          open={true}
          onOpenChange={vi.fn()}
          mode="command"
          onModeChange={vi.fn()}
          modelSections={[]}
          onSearchChange={vi.fn()}
          onSelect={vi.fn()}
          slashCommands={slashCommands}
          onSlashCommand={vi.fn()}
        />
      ),
      { container }
    );
    unmount = () => view.unmount();

    expect(document.body.textContent).toContain("Commands");
    expect(document.body.textContent).toContain("New Session");
    expect(document.body.textContent).toContain("Undo");
  });

  it("filters slash commands by search query", () => {
    const slashCommands: SlashCommand[] = [
      { id: "session.new", trigger: "new", title: "New Session", type: "builtin" },
      { id: "session.undo", trigger: "undo", title: "Undo", type: "builtin" },
      { id: "session.redo", trigger: "redo", title: "Redo", type: "builtin" },
    ];

    const view = render(
      () => (
        <ModelSelector
          open={true}
          onOpenChange={vi.fn()}
          mode="command"
          onModeChange={vi.fn()}
          modelSections={[]}
          onSearchChange={vi.fn()}
          onSelect={vi.fn()}
          slashCommands={slashCommands}
          onSlashCommand={vi.fn()}
          searchQuery="undo"
        />
      ),
      { container }
    );
    unmount = () => view.unmount();

    expect(document.body.textContent).toContain("Undo");
    expect(document.body.textContent).not.toContain("New Session");
    expect(document.body.textContent).not.toContain("Redo");
  });

  it("calls onSlashCommand when selecting a command", () => {
    const onSlashCommand = vi.fn();
    const slashCommands: SlashCommand[] = [
      { id: "session.new", trigger: "new", title: "New Session", type: "builtin" },
    ];

    const view = render(
      () => (
        <ModelSelector
          open={true}
          onOpenChange={vi.fn()}
          mode="command"
          onModeChange={vi.fn()}
          modelSections={[]}
          onSearchChange={vi.fn()}
          onSelect={vi.fn()}
          slashCommands={slashCommands}
          onSlashCommand={onSlashCommand}
        />
      ),
      { container }
    );
    unmount = () => view.unmount();

    const input = document.body.querySelector('input[aria-label="Search models"]');
    input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onSlashCommand).toHaveBeenCalledWith(expect.objectContaining({ id: "session.new" }));
  });

  it("displays keybind for commands", () => {
    const slashCommands: SlashCommand[] = [
      {
        id: "session.new",
        trigger: "new",
        title: "New Session",
        keybind: "mod+shift+s",
        type: "builtin",
      },
    ];

    const view = render(
      () => (
        <ModelSelector
          open={true}
          onOpenChange={vi.fn()}
          mode="command"
          onModeChange={vi.fn()}
          modelSections={[]}
          onSearchChange={vi.fn()}
          onSelect={vi.fn()}
          slashCommands={slashCommands}
          onSlashCommand={vi.fn()}
        />
      ),
      { container }
    );
    unmount = () => view.unmount();

    expect(document.body.textContent).toContain("mod+shift+s");
  });

  it("shows / trigger prefix for commands", () => {
    const slashCommands: SlashCommand[] = [
      { id: "session.new", trigger: "new", title: "New Session", type: "builtin" },
    ];

    const view = render(
      () => (
        <ModelSelector
          open={true}
          onOpenChange={vi.fn()}
          mode="command"
          onModeChange={vi.fn()}
          modelSections={[]}
          onSearchChange={vi.fn()}
          onSelect={vi.fn()}
          slashCommands={slashCommands}
          onSlashCommand={vi.fn()}
        />
      ),
      { container }
    );
    unmount = () => view.unmount();

    expect(document.body.textContent).toContain("/new");
  });

  it("virtualizes model rows in the selector", () => {
    const sections: ModelSelectorSection[] = [
      {
        providerId: "zai",
        providerName: "Z.AI",
        connected: true,
        models: Array.from({ length: 120 }, (_, index) => ({
          id: `zai/glm-${index}`,
          providerId: "zai",
          name: `GLM ${index}`,
          connected: true,
        })),
      },
    ];

    const view = render(
      () => (
        <ModelSelector
          open={true}
          onOpenChange={vi.fn()}
          selectedModelId="zai/glm-0"
          mode="model"
          onModeChange={vi.fn()}
          modelSections={sections}
          onSearchChange={vi.fn()}
          onSelect={vi.fn()}
        />
      ),
      { container }
    );
    unmount = () => view.unmount();

    const options = document.body.querySelectorAll('[role="option"]');
    expect(options.length).toBeGreaterThan(0);
    expect(options.length).toBeLessThan(120);
    expect(
      document.body.querySelector('[data-component="model-selector-virtual-list"]')
    ).toBeTruthy();
  });

  it("keeps provider heading visible in virtualized list", () => {
    const sections: ModelSelectorSection[] = [
      {
        providerId: "zai",
        providerName: "Z.AI",
        connected: true,
        models: [
          { id: "zai/glm-4.7", providerId: "zai", name: "GLM 4.7", connected: true },
          { id: "zai/glm-4.6", providerId: "zai", name: "GLM 4.6", connected: true },
        ],
      },
    ];

    const view = render(
      () => (
        <ModelSelector
          open={true}
          onOpenChange={vi.fn()}
          selectedModelId="zai/glm-4.7"
          mode="model"
          onModeChange={vi.fn()}
          modelSections={sections}
          onSearchChange={vi.fn()}
          onSelect={vi.fn()}
        />
      ),
      { container }
    );
    unmount = () => view.unmount();

    expect(document.body.textContent).toContain("Z.AI");
  });

  it("renders directory context results with trailing slash", () => {
    const onFileSelect = vi.fn();

    const view = render(
      () => (
        <ModelSelector
          open={true}
          onOpenChange={vi.fn()}
          mode="context"
          onModeChange={vi.fn()}
          modelSections={[]}
          onSearchChange={vi.fn()}
          onSelect={vi.fn()}
          fileSearchResults={[
            { path: "/workspace/src", name: "src", score: 5, type: "directory" },
            { path: "/workspace/src/index.ts", name: "index.ts", score: 4, type: "file" },
          ]}
          workspaceRoot="/workspace"
          onFileSelect={onFileSelect}
        />
      ),
      { container }
    );
    unmount = () => view.unmount();

    expect(document.body.textContent).toContain("src/");
    const options = document.body.querySelectorAll('[role="option"]');
    expect(options.length).toBeGreaterThan(1);
  });

  it("scrolls active context result into view when navigating with arrow keys", () => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    const view = render(
      () => (
        <ModelSelector
          open={true}
          onOpenChange={vi.fn()}
          mode="context"
          onModeChange={vi.fn()}
          modelSections={[]}
          onSearchChange={vi.fn()}
          onSelect={vi.fn()}
          fileSearchResults={Array.from({ length: 30 }, (_, index) => ({
            path: `/workspace/src/file-${index}.ts`,
            name: `file-${index}.ts`,
            score: 30 - index,
            type: "file" as const,
          }))}
          workspaceRoot="/workspace"
          onFileSelect={vi.fn()}
        />
      ),
      { container }
    );
    unmount = () => view.unmount();

    const input = document.body.querySelector('input[aria-label="Search models"]');
    expect(input).toBeTruthy();
    input?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(scrollIntoView).toHaveBeenCalled();

    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("allows typing in search input when searchQuery prop is controlled externally with signal", async () => {
    const sections: ModelSelectorSection[] = [
      {
        providerId: "zai",
        providerName: "Z.AI",
        connected: true,
        models: [{ id: "zai/glm-4.7", providerId: "zai", name: "GLM 4.7", connected: true }],
      },
    ];

    const [searchQuery, setSearchQuery] = createSignal("");

    const view = render(
      () => (
        <ModelSelector
          open={true}
          onOpenChange={vi.fn()}
          mode="model"
          onModeChange={vi.fn()}
          modelSections={sections}
          searchQuery={searchQuery()}
          onSearchChange={setSearchQuery}
          onSelect={vi.fn()}
        />
      ),
      { container }
    );
    unmount = () => view.unmount();

    const input = document.body.querySelector(
      'input[aria-label="Search models"]'
    ) as HTMLInputElement;
    expect(input).toBeTruthy();

    input.value = "glm";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    await new Promise(resolve => setTimeout(resolve, 100));

    expect(input.value).toBe("glm");
    expect(searchQuery()).toBe("glm");
  });

  it("resets search input when searchQuery prop is undefined", async () => {
    const onSearchChange = vi.fn();
    const sections: ModelSelectorSection[] = [
      {
        providerId: "zai",
        providerName: "Z.AI",
        connected: true,
        models: [{ id: "zai/glm-4.7", providerId: "zai", name: "GLM 4.7", connected: true }],
      },
    ];

    const view = render(
      () => (
        <ModelSelector
          open={true}
          onOpenChange={vi.fn()}
          mode="model"
          onModeChange={vi.fn()}
          modelSections={sections}
          onSearchChange={onSearchChange}
          onSelect={vi.fn()}
        />
      ),
      { container }
    );
    unmount = () => view.unmount();

    const input = document.body.querySelector(
      'input[aria-label="Search models"]'
    ) as HTMLInputElement;
    expect(input).toBeTruthy();

    input.value = "glm";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    await new Promise(resolve => setTimeout(resolve, 100));

    expect(input.value).toBe("glm");
  });
});
