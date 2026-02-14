import { ModelSelector } from "@/views/components/model-selector";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("ModelSelector", () => {
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

  it("disables models without text capability", () => {
    dispose = render(
      () => (
        <ModelSelector
          models={[
            {
              id: "zai/glm-4.7",
              providerId: "zai",
              capabilities: {
                text: true,
                vision: false,
                tools: true,
                reasoning: true,
                plan: false,
              },
            },
            {
              id: "zai/image-only",
              providerId: "zai",
              capabilities: {
                text: false,
                vision: true,
                tools: false,
                reasoning: false,
                plan: false,
              },
            },
          ]}
          selectedModelId="zai/glm-4.7"
          onChange={vi.fn()}
        />
      ),
      container
    );

    const options = container.querySelectorAll("option");
    expect(options[0]?.disabled).toBe(false);
    expect(options[1]?.disabled).toBe(true);
  });
});
