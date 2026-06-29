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

  it("SkillsInstructions is a string (the instructions body)", () => {
    const s: SkillsInstructions = "first line\nsecond line";
    expect(typeof s).toBe("string");
    expect(s.split("\n")[0]).toBe("first line");
  });
});
