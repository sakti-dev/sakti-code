import { describe, expect, it } from "vite-plus/test";
import {
  formatEditSummary,
  formatFindSummary,
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

describe("formatEditSummary", () => {
  it("extracts path from standard replace-mode args.path", () => {
    const result = formatEditSummary({
      tool: "edit",
      args: { path: "/src/index.ts", edits: [] },
    });
    expect(result).toContain("index.ts");
  });

  it("extracts path from hashline input [path#HASH]", () => {
    const result = formatEditSummary({
      tool: "edit",
      args: {
        input: "[src/foo.ts#1A2B]\nSWAP 1.=2:\n+old\n+new",
      },
    });
    expect(result).toContain("foo.ts");
  });

  it("extracts path from hashline input with nested path", () => {
    const result = formatEditSummary({
      tool: "edit",
      args: {
        input: "[packages/agent/src/index.ts#3C4D]\nDEL 5",
      },
    });
    expect(result).toContain("index.ts");
  });

  it("falls back gracefully when no path found", () => {
    const result = formatEditSummary({
      tool: "edit",
      args: {},
    });
    expect(result).toBe("Edited file");
  });
});

describe("formatFindSummary", () => {
  it("shows pattern from args.pattern", () => {
    const result = formatFindSummary({
      tool: "find",
      args: { pattern: "**/*.ts" },
    });
    expect(result).toContain("**/*.ts");
  });

  it("shows pattern from args.glob", () => {
    const result = formatFindSummary({
      tool: "find",
      args: { glob: "**/*.tsx" },
    });
    expect(result).toContain("**/*.tsx");
  });

  it("includes path when provided", () => {
    const result = formatFindSummary({
      tool: "find",
      args: { pattern: "**/*.ts", path: "/src" },
    });
    expect(result).toContain("/src");
  });
});
