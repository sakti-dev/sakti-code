import { describe, expect, it } from "vitest";
import { INTAKE_SYSTEM_PROMPT } from "~/prompts/intake-system-prompt";

describe("INTAKE_SYSTEM_PROMPT", () => {
  it("is a non-empty string", () => {
    expect(typeof INTAKE_SYSTEM_PROMPT).toBe("string");
    expect(INTAKE_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it("mentions propose_session", () => {
    expect(INTAKE_SYSTEM_PROMPT).toContain("propose_session");
  });
});
