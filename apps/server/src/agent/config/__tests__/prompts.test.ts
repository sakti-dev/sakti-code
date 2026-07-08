import { describe, expect, it } from "vite-plus/test";
import { BASE_PROMPT, VERIFY_PROMPT } from "../prompts.ts";

describe("VERIFY_PROMPT", () => {
  it("composes the base prompt with the neutral verify role", () => {
    expect(VERIFY_PROMPT).toContain(BASE_PROMPT);
    expect(VERIFY_PROMPT).toContain("# Your role: Verify agent");
    expect(VERIFY_PROMPT).toContain("edit-denied");
    expect(VERIFY_PROMPT).toContain("skill");
  });

  it("is neutral — handoff behavior lives in the skill, not the prompt", () => {
    expect(VERIFY_PROMPT).not.toContain('ask({ kind: "verify-complete"');
    expect(VERIFY_PROMPT).not.toContain("Completeness");
  });
});
