import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";
import { type ModelSelectorSection, useModelSelector } from "../hooks";

function sampleSections(): ModelSelectorSection[] {
  return [
    {
      providerId: "openai",
      providerName: "OpenAI",
      models: [
        {
          id: "gpt-4o",
          name: "GPT-4o",
          providerId: "openai",
          reasoning: false,
        },
        { id: "o1", name: "o1", providerId: "openai", reasoning: true },
      ],
    },
    {
      providerId: "anthropic",
      providerName: "Anthropic",
      models: [
        {
          id: "claude-opus",
          name: "Claude Opus",
          providerId: "anthropic",
          reasoning: false,
        },
        {
          id: "claude-sonnet",
          name: "Claude Sonnet",
          providerId: "anthropic",
          reasoning: false,
        },
      ],
    },
    {
      providerId: "google",
      providerName: "Google",
      models: [
        {
          id: "gemini-pro",
          name: "Gemini Pro",
          providerId: "google",
          reasoning: false,
        },
      ],
    },
  ];
}

function manySections(count: number): ModelSelectorSection[] {
  return Array.from({ length: count }, (_, i) => ({
    providerId: `provider-${i}`,
    providerName: `Provider ${i}`,
    models: Array.from({ length: 10 }, (_, j) => ({
      id: `model-${i}-${j}`,
      name: `Model ${i}-${j}`,
      providerId: `provider-${i}`,
      reasoning: false,
    })),
  }));
}

describe("useModelSelector", () => {
  it("filteredSections returns all sections when query is empty", () => {
    createRoot(() => {
      const sections = sampleSections();
      const onSelect = vi.fn();
      const result = useModelSelector({
        modelSections: sections,
        open: true,
        onSelect,
        onOpenChange: vi.fn(),
      });

      const filtered = result.filteredSections();
      expect(filtered.length).toBe(3);
      expect(filtered[0]!.models.length).toBe(2);
      expect(filtered[1]!.models.length).toBe(2);
      expect(filtered[2]!.models.length).toBe(1);
    });
  });

  it("filteredSections filters by model id", () => {
    createRoot(() => {
      const sections = sampleSections();
      const onSelect = vi.fn();
      const result = useModelSelector({
        modelSections: sections,
        open: true,
        onSelect,
        onOpenChange: vi.fn(),
      });

      result.setQuery("gpt-4o");

      const filtered = result.filteredSections();
      expect(filtered.length).toBe(1);
      expect(filtered[0]!.providerId).toBe("openai");
      expect(filtered[0]!.models.length).toBe(1);
      expect(filtered[0]!.models[0]!.id).toBe("gpt-4o");
    });
  });

  it("filteredSections filters by model name", () => {
    createRoot(() => {
      const sections = sampleSections();
      const onSelect = vi.fn();
      const result = useModelSelector({
        modelSections: sections,
        open: true,
        onSelect,
        onOpenChange: vi.fn(),
      });

      result.setQuery("claude");

      const filtered = result.filteredSections();
      expect(filtered.length).toBe(1);
      expect(filtered[0]!.providerId).toBe("anthropic");
      expect(filtered[0]!.models.length).toBe(2);
    });
  });

  it("filteredSections filters by provider id", () => {
    createRoot(() => {
      const sections = sampleSections();
      const onSelect = vi.fn();
      const result = useModelSelector({
        modelSections: sections,
        open: true,
        onSelect,
        onOpenChange: vi.fn(),
      });

      result.setQuery("google");

      const filtered = result.filteredSections();
      expect(filtered.length).toBe(1);
      expect(filtered[0]!.providerId).toBe("google");
      expect(filtered[0]!.models.length).toBe(1);
    });
  });

  it("filteredSections returns empty when query matches nothing", () => {
    createRoot(() => {
      const sections = sampleSections();
      const onSelect = vi.fn();
      const result = useModelSelector({
        modelSections: sections,
        open: true,
        onSelect,
        onOpenChange: vi.fn(),
      });

      result.setQuery("zzznonexistent");

      const filtered = result.filteredSections();
      expect(filtered.length).toBe(0);
    });
  });

  it("filteredSections is case-insensitive", () => {
    createRoot(() => {
      const sections = sampleSections();
      const onSelect = vi.fn();
      const result = useModelSelector({
        modelSections: sections,
        open: true,
        onSelect,
        onOpenChange: vi.fn(),
      });

      result.setQuery("GPT-4O");

      const filtered = result.filteredSections();
      expect(filtered.length).toBe(1);
      expect(filtered[0]!.models[0]!.id).toBe("gpt-4o");
    });
  });

  it("modelEntries returns flat list across all filtered sections", () => {
    createRoot(() => {
      const sections = sampleSections();
      const onSelect = vi.fn();
      const result = useModelSelector({
        modelSections: sections,
        open: true,
        onSelect,
        onOpenChange: vi.fn(),
      });

      const entries = result.modelEntries();
      expect(entries.length).toBe(5);
      expect(entries[0]!.id).toBe("gpt-4o");
      expect(entries[0]!.subtitle).toBe("OpenAI");
      expect(entries[1]!.id).toBe("o1");
      expect(entries[2]!.id).toBe("claude-opus");
      expect(entries[3]!.id).toBe("claude-sonnet");
      expect(entries[4]!.id).toBe("gemini-pro");
    });
  });

  it("modelEntries filters when query changes", () => {
    createRoot(() => {
      const sections = sampleSections();
      const onSelect = vi.fn();
      const result = useModelSelector({
        modelSections: sections,
        open: true,
        onSelect,
        onOpenChange: vi.fn(),
      });

      expect(result.modelEntries().length).toBe(5);

      result.setQuery("gemini");
      expect(result.modelEntries().length).toBe(1);
      expect(result.modelEntries()[0]!.id).toBe("gemini-pro");
    });
  });

  it("modelRows interleaves headings and models", () => {
    createRoot(() => {
      const sections = sampleSections();
      const onSelect = vi.fn();
      const result = useModelSelector({
        modelSections: sections,
        open: true,
        onSelect,
        onOpenChange: vi.fn(),
      });

      const rows = result.modelRows();
      expect(rows.length).toBe(8); // 3 headings + 5 models
      expect(rows[0]!.kind).toBe("heading");
      expect(rows[0]).toHaveProperty("providerName", "OpenAI");
      expect(rows[1]!.kind).toBe("model");
      expect(rows[1]).toHaveProperty("key", "model:gpt-4o");
      expect(rows[2]!.kind).toBe("model");
      expect(rows[2]).toHaveProperty("key", "model:o1");
      expect(rows[3]!.kind).toBe("heading");
      expect(rows[3]).toHaveProperty("providerName", "Anthropic");
      expect(rows[4]!.kind).toBe("model");
      expect(rows[4]).toHaveProperty("key", "model:claude-opus");
      expect(rows[5]!.kind).toBe("model");
      expect(rows[5]).toHaveProperty("key", "model:claude-sonnet");
      expect(rows[6]!.kind).toBe("heading");
      expect(rows[6]).toHaveProperty("providerName", "Google");
      expect(rows[7]!.kind).toBe("model");
      expect(rows[7]).toHaveProperty("key", "model:gemini-pro");
    });
  });

  it("modelRowIndexById maps model id to row index", () => {
    createRoot(() => {
      const sections = sampleSections();
      const onSelect = vi.fn();
      const result = useModelSelector({
        modelSections: sections,
        open: true,
        onSelect,
        onOpenChange: vi.fn(),
      });

      const map = result.modelRowIndexById();
      expect(map.get("gpt-4o")).toBe(1);
      expect(map.get("o1")).toBe(2);
      expect(map.get("claude-opus")).toBe(4);
      expect(map.get("claude-sonnet")).toBe(5);
      expect(map.get("gemini-pro")).toBe(7);
    });
  });

  it("visibleModelRows returns all rows when content fits viewport", () => {
    createRoot(() => {
      const sections = sampleSections();
      const onSelect = vi.fn();
      const result = useModelSelector({
        modelSections: sections,
        open: true,
        onSelect,
        onOpenChange: vi.fn(),
      });

      // 8 rows × 40px = 320px, viewport default 404px → all visible
      const visible = result.visibleModelRows();
      expect(visible.length).toBe(8);
      expect(visible[0]!.absoluteIndex).toBe(0);
      expect(visible[7]!.absoluteIndex).toBe(7);
    });
  });

  it("visibleModelRows windows when content overflows viewport", () => {
    createRoot(() => {
      const sections = manySections(5); // 5 headings + 50 models = 55 rows
      const onSelect = vi.fn();
      const result = useModelSelector({
        modelSections: sections,
        open: true,
        onSelect,
        onOpenChange: vi.fn(),
      });

      // 55 rows × 40px = 2200px, viewport 404px, start=0, end=floor(404/40)+8 = 18
      const visible = result.visibleModelRows();
      expect(visible.length).toBeLessThan(55);
      expect(visible[0]!.absoluteIndex).toBe(0);
    });
  });

  it("visibleModelRows shifts window when scrolling", () => {
    createRoot(() => {
      const sections = manySections(5);
      const onSelect = vi.fn();
      const result = useModelSelector({
        modelSections: sections,
        open: true,
        onSelect,
        onOpenChange: vi.fn(),
      });

      result.setModelScrollTop(800); // scroll down

      const visible = result.visibleModelRows();
      const start = Math.max(0, Math.floor(800 / 40) - 8);
      expect(visible[0]!.absoluteIndex).toBe(start);
    });
  });

  it("handlePick calls onSelect and resets state", () => {
    createRoot(() => {
      const sections = sampleSections();
      const onSelect = vi.fn();
      const onOpenChange = vi.fn();
      const result = useModelSelector({
        modelSections: sections,
        open: true,
        onSelect,
        onOpenChange,
      });

      // Set a query first
      result.setQuery("gpt-4o");
      expect(result.query()).toBe("gpt-4o");

      result.handlePick("gpt-4o", "openai", false);

      expect(onSelect).toHaveBeenCalledWith("gpt-4o", "openai", false);
      expect(result.query()).toBe("");
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("handlePick passes reasoning flag", () => {
    createRoot(() => {
      const sections = sampleSections();
      const onSelect = vi.fn();
      const result = useModelSelector({
        modelSections: sections,
        open: true,
        onSelect,
        onOpenChange: vi.fn(),
      });

      result.handlePick("o1", "openai", true);
      expect(onSelect).toHaveBeenCalledWith("o1", "openai", true);
    });
  });

  describe("handleInputKeyDown", () => {
    it("ArrowDown increments activeIndex", () => {
      createRoot(() => {
        const sections = sampleSections();
        const result = useModelSelector({
          modelSections: sections,
          open: true,
          onSelect: vi.fn(),
          onOpenChange: vi.fn(),
        });

        expect(result.activeIndex()).toBe(0);

        result.handleInputKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
        expect(result.activeIndex()).toBe(1);

        result.handleInputKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
        expect(result.activeIndex()).toBe(2);
      });
    });

    it("ArrowDown wraps around at the end", () => {
      createRoot(() => {
        const sections = sampleSections();
        const result = useModelSelector({
          modelSections: sections,
          open: true,
          onSelect: vi.fn(),
          onOpenChange: vi.fn(),
        });

        // Navigate to last item (index 4)
        for (let i = 0; i < 5; i++) {
          result.handleInputKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
        }
        // 5 presses from 0 → wraps: 1,2,3,4,0
        expect(result.activeIndex()).toBe(0);
      });
    });

    it("ArrowUp decrements activeIndex", () => {
      createRoot(() => {
        const sections = sampleSections();
        const result = useModelSelector({
          modelSections: sections,
          open: true,
          onSelect: vi.fn(),
          onOpenChange: vi.fn(),
        });

        // Start at index 3
        for (let i = 0; i < 3; i++) {
          result.handleInputKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
        }
        expect(result.activeIndex()).toBe(3);

        result.handleInputKeyDown(new KeyboardEvent("keydown", { key: "ArrowUp" }));
        expect(result.activeIndex()).toBe(2);

        result.handleInputKeyDown(new KeyboardEvent("keydown", { key: "ArrowUp" }));
        expect(result.activeIndex()).toBe(1);
      });
    });

    it("ArrowUp wraps around at the beginning", () => {
      createRoot(() => {
        const sections = sampleSections();
        const result = useModelSelector({
          modelSections: sections,
          open: true,
          onSelect: vi.fn(),
          onOpenChange: vi.fn(),
        });

        expect(result.activeIndex()).toBe(0);

        result.handleInputKeyDown(new KeyboardEvent("keydown", { key: "ArrowUp" }));
        expect(result.activeIndex()).toBe(4); // wraps to last
      });
    });

    it("Enter calls handlePick for active entry", () => {
      createRoot(() => {
        const sections = sampleSections();
        const onSelect = vi.fn();
        const onOpenChange = vi.fn();
        const result = useModelSelector({
          modelSections: sections,
          open: true,
          onSelect,
          onOpenChange,
        });

        // Navigate to claude-sonnet (index 3)
        for (let i = 0; i < 3; i++) {
          result.handleInputKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
        }

        result.handleInputKeyDown(new KeyboardEvent("keydown", { key: "Enter" }));
        expect(onSelect).toHaveBeenCalledWith("claude-sonnet", "anthropic", false);
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it("Enter is no-op when no entries available", () => {
      createRoot(() => {
        const onSelect = vi.fn();
        const onOpenChange = vi.fn();
        const result = useModelSelector({
          modelSections: [],
          open: true,
          onSelect,
          onOpenChange,
        });

        result.handleInputKeyDown(new KeyboardEvent("keydown", { key: "Enter" }));
        expect(onSelect).not.toHaveBeenCalled();
        expect(onOpenChange).not.toHaveBeenCalled();
      });
    });

    it("Escape calls onOpenChange(false)", () => {
      createRoot(() => {
        const sections = sampleSections();
        const onOpenChange = vi.fn();
        const result = useModelSelector({
          modelSections: sections,
          open: true,
          onSelect: vi.fn(),
          onOpenChange,
        });

        result.handleInputKeyDown(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it("ArrowDown/ArrowUp/Enter are no-op when no entries", () => {
      createRoot(() => {
        const onSelect = vi.fn();
        const onOpenChange = vi.fn();
        const result = useModelSelector({
          modelSections: [],
          open: true,
          onSelect,
          onOpenChange,
        });

        result.handleInputKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
        result.handleInputKeyDown(new KeyboardEvent("keydown", { key: "ArrowUp" }));
        result.handleInputKeyDown(new KeyboardEvent("keydown", { key: "Enter" }));
        expect(onSelect).not.toHaveBeenCalled();
        expect(onOpenChange).not.toHaveBeenCalled();
      });
    });

    it("preventDefault on navigation keys", () => {
      createRoot(() => {
        const sections = sampleSections();
        const result = useModelSelector({
          modelSections: sections,
          open: true,
          onSelect: vi.fn(),
          onOpenChange: vi.fn(),
        });

        const downEvent = new KeyboardEvent("keydown", { key: "ArrowDown" });
        const upEvent = new KeyboardEvent("keydown", { key: "ArrowUp" });
        const enterEvent = new KeyboardEvent("keydown", { key: "Enter" });
        const escapeEvent = new KeyboardEvent("keydown", { key: "Escape" });

        const downSpy = vi.spyOn(downEvent, "preventDefault");
        const upSpy = vi.spyOn(upEvent, "preventDefault");
        const enterSpy = vi.spyOn(enterEvent, "preventDefault");
        const escapeSpy = vi.spyOn(escapeEvent, "preventDefault");

        result.handleInputKeyDown(downEvent);
        result.handleInputKeyDown(upEvent);
        result.handleInputKeyDown(enterEvent);
        result.handleInputKeyDown(escapeEvent);

        expect(downSpy).toHaveBeenCalled();
        expect(upSpy).toHaveBeenCalled();
        expect(enterSpy).toHaveBeenCalled();
        expect(escapeSpy).toHaveBeenCalled();
      });
    });
  });

  describe("isActive", () => {
    it("returns true for model at activeIndex", () => {
      createRoot(() => {
        const sections = sampleSections();
        const result = useModelSelector({
          modelSections: sections,
          open: true,
          onSelect: vi.fn(),
          onOpenChange: vi.fn(),
        });

        expect(result.isActive("gpt-4o")).toBe(true);
        expect(result.isActive("o1")).toBe(false);

        result.handleInputKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
        expect(result.isActive("gpt-4o")).toBe(false);
        expect(result.isActive("o1")).toBe(true);
      });
    });

    it("returns false for unknown id", () => {
      createRoot(() => {
        const sections = sampleSections();
        const result = useModelSelector({
          modelSections: sections,
          open: true,
          onSelect: vi.fn(),
          onOpenChange: vi.fn(),
        });

        expect(result.isActive("nonexistent")).toBe(false);
      });
    });

    it("returns false when no entries exist", () => {
      createRoot(() => {
        const result = useModelSelector({
          modelSections: [],
          open: true,
          onSelect: vi.fn(),
          onOpenChange: vi.fn(),
        });

        expect(result.isActive("anything")).toBe(false);
      });
    });
  });
});
