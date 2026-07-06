import { describe, expect, it } from "vite-plus/test";
import { BASE_PROMPT, VERIFY_PROMPT } from "../prompts.ts";

describe("VERIFY_PROMPT", () => {
  it("composes the base prompt with the verify role", () => {
    expect(VERIFY_PROMPT).toContain(BASE_PROMPT);
    expect(VERIFY_PROMPT).toContain("# Your role: Verify agent");
    expect(VERIFY_PROMPT).toContain("edit-denied");
    expect(VERIFY_PROMPT).toContain('ask({ kind: "verify-complete"');
  });

  it("lists the three verification dimensions", () => {
    expect(VERIFY_PROMPT).toContain("Completeness");
    expect(VERIFY_PROMPT).toContain("Correctness");
    expect(VERIFY_PROMPT).toContain("Coherence");
  });
});
