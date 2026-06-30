import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolResult } from "@sakti-code/agent";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createGrepTool, formatRgJsonStream } from "../index.ts";

function getTextContent(result: AgentToolResult<unknown>): string {
  const first = result.content[0];
  if (first && "text" in first) {
    return first.text;
  }
  return "";
}

describe("grep: single-pass JSON formatting", () => {
  it("emits path:line:text for matches and path-line-text for context", () => {
    const stream = [
      JSON.stringify({
        type: "match",
        data: {
          path: { text: "/p/src/a.ts" },
          line_number: 2,
          lines: { text: "export const X = 1;\n" },
        },
      }),
      JSON.stringify({
        type: "context",
        data: {
          path: { text: "/p/src/a.ts" },
          line_number: 3,
          lines: { text: "const Y = 2;\n" },
        },
      }),
    ].join("\n");
    const { output: out } = formatRgJsonStream(stream, "/p");
    expect(out).toContain("src/a.ts:2: export const X = 1;");
    expect(out).toContain("src/a.ts-3- const Y = 2;");
  });

  it("garbling regression: CRLF in a context line is normalized, no \\r leaks", () => {
    const stream = JSON.stringify({
      type: "context",
      data: {
        path: { text: "/p/a.ts" },
        line_number: 5,
        lines: { text: "import { z } from 'z';\r\n" },
      },
    });
    const { output: out } = formatRgJsonStream(stream, "/p");
    expect(out).not.toContain("\r");
    expect(out.endsWith("import { z } from 'z';")).toBe(true);
  });

  it("long-line defense: a >maxChars match line is truncated (rg --max-columns is ignored under --json)", () => {
    const long = "a".repeat(2000);
    const stream = JSON.stringify({
      type: "match",
      data: { path: { text: "/p/a.ts" }, line_number: 1, lines: { text: long + "\n" } },
    });
    const { output: out } = formatRgJsonStream(stream, "/p");
    expect(out).toContain("[truncated]");
    expect(out.length).toBeLessThan(1200);
  });

  it("ignores begin/end/summary records", () => {
    const stream = [
      JSON.stringify({ type: "begin", data: { path: { text: "/p/a.ts" } } }),
      JSON.stringify({
        type: "match",
        data: { path: { text: "/p/a.ts" }, line_number: 1, lines: { text: "x\n" } },
      }),
      JSON.stringify({ type: "end", data: {} }),
    ].join("\n");
    const { output: out } = formatRgJsonStream(stream, "/p");
    expect(out).toContain("a.ts:1: x");
    expect(out).not.toContain("begin");
  });
});

describe("grep: rg argv validity", () => {
  it("uses only flags the real rg binary accepts for the grep invocation", () => {
    const flags = [
      "--no-config",
      "--json",
      "--smart-case",
      "--hidden",
      "--no-ignore",
      "--glob=!**/.git/**",
      "--glob=!**/node_modules/**",
      "--fixed-strings",
      "--context=2",
    ];
    expect(() => {
      execFileSync("rg", [...flags, "--", "x", "."], { stdio: "ignore" });
    }).not.toThrow();
  });
});

describe("grep: gitignore regression (--no-ignore reaches gitignored content)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sakti-grep-gitignore-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("finds matches inside a gitignored file instead of a false 'no matches'", async () => {
    writeFileSync(join(dir, ".gitignore"), "secret.ts\n");
    writeFileSync(join(dir, "secret.ts"), "UNIQUE_MARKER_TOKEN\n");
    const tool = createGrepTool(dir);
    const result = await tool.execute("tc", { pattern: "UNIQUE_MARKER_TOKEN" });
    const text = getTextContent(result);
    expect(text).toContain("secret.ts");
  });
});
