import { ModelSelector } from "@/components/model-selector";
import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("ModelSelector", () => {
  let container: HTMLDivElement;
  let unmount: (() => void) | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    unmount?.();
    cleanup();
    if (container.parentNode === document.body) {
      document.body.removeChild(container);
    }
  });

  it("renders models from sections and selects a model", async () => {
    const onSelect = vi.fn();

    const view = render(
      () => (
        <ModelSelector
          open={true}
          onOpenChange={vi.fn()}
          mode="model"
          onModeChange={vi.fn()}
          modelSections={[
            {
              providerId: "zai",
              providerName: "Z.AI",
              connected: true,
              models: [
                { id: "zai/glm-4.7", providerId: "zai", connected: true, name: "GLM 4.7" },
                { id: "zai/glm-4.6", providerId: "zai", connected: true, name: "GLM 4.6" },
              ],
            },
          ]}
          selectedModelId="zai/glm-4.7"
          onSearchChange={vi.fn()}
          onSelect={onSelect}
        />
      ),
      { container }
    );
    unmount = () => view.unmount();

    await Promise.resolve();

    expect(document.body.textContent).toContain("Z.AI");
    expect(document.body.textContent).toContain("GLM 4.7");
    expect(document.body.textContent).toContain("GLM 4.6");

    const options = document.body.querySelectorAll('[role="option"]');
    expect(options.length).toBeGreaterThan(0);
    options[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith("zai/glm-4.6");
  });
});
