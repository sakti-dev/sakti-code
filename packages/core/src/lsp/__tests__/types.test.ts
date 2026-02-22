import type { LSPDiagnostic } from "@/lsp/types";
import { describe, expect, it } from "vitest";

describe("LSP Types", () => {
  describe("LSPDiagnostic", () => {
    it("should have required severity levels", () => {
      const diagnostic: LSPDiagnostic = {
        severity: 1,
        message: "Syntax error",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
        },
      };
      expect(diagnostic.severity).toBe(1);
    });
  });
});
