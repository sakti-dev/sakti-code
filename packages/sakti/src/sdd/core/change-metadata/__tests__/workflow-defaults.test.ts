import { describe, it, expect } from "vitest";
import { getStateDefaultsForWorkflow } from "../workflow-defaults.js";

describe("getStateDefaultsForWorkflow", () => {
  it("returns full-workflow defaults with null build decisions", () => {
    const defaults = getStateDefaultsForWorkflow("full");
    expect(defaults.workflow).toBe("full");
    expect(defaults.phase).toBe("open");
    expect(defaults.build_mode).toBeNull();
    expect(defaults.review_mode).toBeNull();
    expect(defaults.isolation).toBeNull();
    expect(defaults.verify_mode).toBeNull();
  });

  it("returns hotfix defaults with direct build mode", () => {
    const defaults = getStateDefaultsForWorkflow("hotfix");
    expect(defaults.workflow).toBe("hotfix");
    expect(defaults.phase).toBe("open");
    expect(defaults.build_mode).toBe("direct");
    expect(defaults.review_mode).toBe("off");
    expect(defaults.isolation).toBe("branch");
    expect(defaults.verify_mode).toBe("light");
  });
});
