import { describe, it, expect } from "vitest";
import { ChangeMetadataSchema } from "../schema.js";

describe("ChangeMetadataSchema state machine fields", () => {
  describe("defaults", () => {
    it("applies full-workflow defaults when only schema is provided", () => {
      const result = ChangeMetadataSchema.safeParse({ schema: "spec-driven" });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.workflow).toBe("full");
      expect(result.data.phase).toBe("open");
      expect(result.data.auto_transition).toBe(true);
      expect(result.data.verify_result).toBe("pending");
      expect(result.data.branch_status).toBe("pending");
      expect(result.data.archived).toBe(false);
      expect(result.data.direct_override).toBe(false);
      expect(result.data.build_mode).toBeNull();
      expect(result.data.isolation).toBeNull();
      expect(result.data.base_ref).toBeNull();
    });
  });

  describe("enum validation", () => {
    it("rejects invalid workflow", () => {
      const result = ChangeMetadataSchema.safeParse({
        schema: "spec-driven",
        workflow: "bogus",
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid phase", () => {
      const result = ChangeMetadataSchema.safeParse({
        schema: "spec-driven",
        phase: "middle",
      });
      expect(result.success).toBe(false);
    });

    it("accepts all valid phases", () => {
      for (const phase of ["open", "specify", "build", "verify", "archive"] as const) {
        const result = ChangeMetadataSchema.safeParse({
          schema: "spec-driven",
          phase,
        });
        expect(result.success).toBe(true);
      }
    });

    it("accepts all valid build_mode values", () => {
      for (const mode of ["subagent", "direct"] as const) {
        const result = ChangeMetadataSchema.safeParse({
          schema: "spec-driven",
          build_mode: mode,
        });
        expect(result.success).toBe(true);
      }
    });

    it("accepts null for nullable fields", () => {
      const result = ChangeMetadataSchema.safeParse({
        schema: "spec-driven",
        build_mode: null,
        base_ref: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("backward compatibility", () => {
    it("still accepts existing metadata without state fields", () => {
      const result = ChangeMetadataSchema.safeParse({
        schema: "spec-driven",
        created: "2025-01-05",
        goal: "ship it",
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.created).toBe("2025-01-05");
      expect(result.data.goal).toBe("ship it");
    });
  });
});
