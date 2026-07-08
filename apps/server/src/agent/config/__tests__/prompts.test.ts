import { describe, expect, it } from "vite-plus/test";
import { BASE_PROMPT, EXPLORE_PROMPT, GENERAL_PROMPT } from "../prompts.ts";

describe("stable system prompt", () => {
  it("BASE_PROMPT carries the shared tone/style and task guidance", () => {
    expect(BASE_PROMPT).toContain("Tone and style");
    expect(BASE_PROMPT).toContain("concise");
    expect(BASE_PROMPT).toContain("Following conventions");
    expect(BASE_PROMPT).toContain("Doing tasks");
    expect(BASE_PROMPT).toContain("Tool usage policy");
    expect(BASE_PROMPT).toContain("Code references");
  });

  it("subagents still compose their own role section onto BASE_PROMPT", () => {
    expect(EXPLORE_PROMPT.startsWith(BASE_PROMPT)).toBe(true);
    expect(EXPLORE_PROMPT).toContain("Explore agent");
    expect(GENERAL_PROMPT.startsWith(BASE_PROMPT)).toBe(true);
    expect(GENERAL_PROMPT).toContain("General agent");
  });
});
