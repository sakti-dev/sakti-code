import { describe, expect, it } from "vitest";
import {
  formatTaskCreateSummary,
  formatTaskUpdateSummary,
  formatVscodeDiagnosticsSummary,
  formatWebfetchSummary,
} from "../tool-summary-formatters.ts";

describe("tool summary formatters — new tools", () => {
  it("formatTaskCreateSummary shows subject", () => {
    const result = formatTaskCreateSummary({
      tool: "TaskCreate",
      args: { subject: "Fix typo", description: "long..." },
    });
    expect(result).toBe("Created task: Fix typo");
  });

  it("formatTaskUpdateSummary shows status", () => {
    const result = formatTaskUpdateSummary({
      tool: "TaskUpdate",
      args: { taskId: "1", status: "in_progress" },
    });
    expect(result).toBe("Task 1 → in_progress");
  });

  it("formatWebfetchSummary shows domain", () => {
    const result = formatWebfetchSummary({
      tool: "webfetch",
      args: {
        url: "https://example.com/page",
        prompt: "extract info",
      },
    });
    expect(result).toBe("Fetched example.com");
  });

  it("formatVscodeDiagnosticsSummary shows clean when no issues", () => {
    const result = formatVscodeDiagnosticsSummary({
      tool: "vscode_get_diagnostics",
      args: {},
      output: "No problems found",
    });
    expect(result).toContain("clean");
  });

  it("formatVscodeDiagnosticsSummary shows issues when present", () => {
    const result = formatVscodeDiagnosticsSummary({
      tool: "vscode_get_diagnostics",
      args: {},
      output: "3 issues found",
    });
    expect(result).toContain("issues");
  });
});
