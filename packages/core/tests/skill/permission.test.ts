import type { PermissionAction, PermissionRule, PermissionType } from "@ekacode/shared";
import { describe, expect, it } from "vitest";
import { createDefaultRules, evaluatePatterns } from "../../src/security/permission-rules";

describe("skill permissions", () => {
  it("should allow read access with wildcard pattern", () => {
    const defaultRules = createDefaultRules();

    const readRules = defaultRules.filter(r => r.permission === "read");
    const result = evaluatePatterns("read" as PermissionType, ["some/path"], readRules);
    expect(result.action).toBe("allow");
  });

  it("should handle ask action for skills", () => {
    const rules: PermissionRule[] = [
      { permission: "read" as PermissionType, pattern: "*", action: "ask" as PermissionAction },
    ];

    const result = evaluatePatterns("read" as PermissionType, ["any-skill"], rules);
    expect(result.action).toBe("ask");
  });

  it("should have default permission rules defined", () => {
    const defaultRules = createDefaultRules();
    expect(defaultRules.length).toBeGreaterThan(0);

    const readRules = defaultRules.filter(r => r.permission === "read");
    expect(readRules.length).toBeGreaterThan(0);

    const editRules = defaultRules.filter(r => r.permission === "edit");
    expect(editRules.length).toBeGreaterThan(0);
  });
});
