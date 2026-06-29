import { describe, expect, it } from "vitest";
import type {
  BranchSummaryPrompts,
  CompactionPrompts,
  SkillsInstructions,
} from "../prompt-bundles.ts";

describe("prompt bundle types", () => {
  it("CompactionPrompts has all four fields", () => {
    const p: CompactionPrompts = {
      summarizationSystem: "sys",
      summarization: "sum",
      update: "upd",
      turnPrefix: "tp",
    };
    expect(p.summarization).toBe("sum");
    expect(p.update).toBe("upd");
    expect(p.turnPrefix).toBe("tp");
    expect(p.summarizationSystem).toBe("sys");
  });

  it("BranchSummaryPrompts has preamble + prompt + systemPrompt", () => {
    const p: BranchSummaryPrompts = {
      preamble: "pre",
      prompt: "p",
      systemPrompt: "sys",
    };
    expect(p.prompt).toBe("p");
    expect(p.preamble).toBe("pre");
    expect(p.systemPrompt).toBe("sys");
  });

  it("SkillsInstructions is a readonly string array", () => {
    const s: SkillsInstructions = ["a", "b"];
    expect(s.length).toBe(2);
    expect(s[0]).toBe("a");
  });
});
