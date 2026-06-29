import { render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vite-plus/test";
import { ModelSelectorDialog } from "..";
import type { ModelSelectorSection } from "../hooks";

const mockSections: ModelSelectorSection[] = [
  {
    providerId: "openai",
    providerName: "OpenAI",
    models: [
      { id: "gpt-4o", name: "GPT-4o", providerId: "openai", reasoning: false },
      { id: "o1", name: "o1", providerId: "openai", reasoning: true },
    ],
  },
];

describe("ModelSelectorDialog", () => {
  it("renders content when open", async () => {
    render(() => (
      <ModelSelectorDialog
        modelSections={mockSections}
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
        open={true}
      />
    ));

    await waitFor(() => {
      expect(screen.getByText("Selecting model")).toBeTruthy();
    });
  });

  it("does not render content when closed", async () => {
    render(() => (
      <ModelSelectorDialog
        modelSections={mockSections}
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
        open={false}
      />
    ));

    await waitFor(() => {
      expect(screen.queryByText("Selecting model")).toBeNull();
    });
  });

  it("renders model names from sections", async () => {
    render(() => (
      <ModelSelectorDialog
        modelSections={mockSections}
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
        open={true}
      />
    ));

    await waitFor(() => {
      expect(screen.getByText("GPT-4o")).toBeTruthy();
      expect(screen.getByText("o1")).toBeTruthy();
    });
  });

  it("renders provider name heading", async () => {
    render(() => (
      <ModelSelectorDialog
        modelSections={mockSections}
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
        open={true}
      />
    ));

    await waitFor(() => {
      expect(screen.getByText("OpenAI")).toBeTruthy();
    });
  });

  it("renders empty state when no models match", async () => {
    render(() => (
      <ModelSelectorDialog
        modelSections={[]}
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
        open={true}
      />
    ));

    await waitFor(() => {
      expect(screen.getByText("No results found.")).toBeTruthy();
    });
  });

  it("calls onSelect when a model is picked", async () => {
    const onSelect = vi.fn();
    render(() => (
      <ModelSelectorDialog
        modelSections={mockSections}
        onOpenChange={vi.fn()}
        onSelect={onSelect}
        open={true}
      />
    ));

    await waitFor(() => {
      expect(screen.getByText("GPT-4o")).toBeTruthy();
    });

    const modelButton = screen.getByText("GPT-4o").closest("button");
    expect(modelButton).toBeTruthy();
    modelButton!.click();

    expect(onSelect).toHaveBeenCalledWith("gpt-4o", "openai", false);
  });

  it("calls onOpenChange(false) when escape is pressed", async () => {
    const onOpenChange = vi.fn();
    render(() => (
      <ModelSelectorDialog
        modelSections={mockSections}
        onOpenChange={onOpenChange}
        onSelect={vi.fn()}
        open={true}
      />
    ));

    await waitFor(() => {
      expect(screen.getByText("Selecting model")).toBeTruthy();
    });

    const searchInput = screen.getByRole("combobox");
    searchInput.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
