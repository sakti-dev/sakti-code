import { describe, expect, it } from "vitest";
import { playgroundPresets } from "../dev/fixtures/presets";

describe("playground presets", () => {
  it("exposes a single long-form incremark-derived preset", () => {
    expect(playgroundPresets).toHaveLength(1);

    const preset = playgroundPresets[0];
    expect(preset).toHaveProperty("id", "incremark-solid-example");
    expect(preset).toHaveProperty("label", "Incremark Example");
    expect(preset).toHaveProperty("description");
    expect(preset).toHaveProperty("markdown");
    expect(preset?.markdown.length ?? 0).toBeGreaterThan(8000);
  });

  it("uses the copied incremark solid example sample as the only playground source", () => {
    const incremarkPreset = playgroundPresets[0];

    expect(incremarkPreset?.markdown).toContain(
      "# 🚀 Incremark SolidJS Example"
    );
    expect(incremarkPreset?.markdown).toContain("## 📊 Mermaid Charts");
    expect(incremarkPreset?.markdown).toContain("## 🎨 Custom Containers");
    expect(incremarkPreset?.markdown).toContain("## 💻 Code Highlighting");
    expect(incremarkPreset?.markdown).toContain("## 📜 Footnote Support");
  });

  it("expands the incremark example with a broader mermaid section", () => {
    const incremarkPreset = playgroundPresets[0];

    expect(incremarkPreset?.markdown).toContain("```mermaid");
    expect(incremarkPreset?.markdown).toContain("sequenceDiagram");
    expect(incremarkPreset?.markdown).toContain("classDiagram");
    expect(incremarkPreset?.markdown).toContain("stateDiagram-v2");
    expect(incremarkPreset?.markdown).toContain("erDiagram");
    expect(incremarkPreset?.markdown).toContain("journey");
    expect(incremarkPreset?.markdown).toContain("gantt");
    expect(incremarkPreset?.markdown).toContain("mindmap");
    expect(incremarkPreset?.markdown).toContain("pie title");
  });
});
