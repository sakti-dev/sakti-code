import { describe, it, expect } from "vitest";
import type { NewChangeOptions } from "../../commands/workflow/new-change.js";

describe("NewChangeOptions workflow field", () => {
  it("accepts workflow option", () => {
    const opts: NewChangeOptions = { workflow: "hotfix" };
    expect(opts.workflow).toBe("hotfix");
  });

  it("workflow is optional (defaults to full in createChange)", () => {
    const opts: NewChangeOptions = {};
    expect(opts.workflow).toBeUndefined();
  });
});
