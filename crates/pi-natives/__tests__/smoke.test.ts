import { describe, expect, it } from "vitest";
import { blockRangeAt } from "../index.js";

describe("blockRangeAt (napi)", () => {
  const TS = "function x() {\n  if (y) {\n  }\n}\n";

  it("resolves the function block beginning on line 1", () => {
    expect(blockRangeAt({ code: TS, path: "x.ts", line: 1 })).toEqual({
      startLine: 1,
      endLine: 4,
    });
  });

  it("resolves the inner if block on line 2", () => {
    expect(blockRangeAt({ code: TS, path: "x.ts", line: 2 })).toEqual({
      startLine: 2,
      endLine: 3,
    });
  });

  it("returns null for a lone closing brace (line 3)", () => {
    expect(blockRangeAt({ code: TS, path: "x.ts", line: 3 })).toBeNull();
  });

  it("returns null for a blank line", () => {
    expect(
      blockRangeAt({
        code: "function f() {\n\n  return 1;\n}\n",
        path: "f.ts",
        line: 2,
      })
    ).toBeNull();
  });

  it("resolves a python def (indentation language)", () => {
    expect(
      blockRangeAt({
        code: "def greet():\n    return 1\n",
        path: "g.py",
        line: 1,
      })
    ).toEqual({ startLine: 1, endLine: 2 });
  });

  it("returns null for an unrecognized extension", () => {
    expect(
      blockRangeAt({ code: "function x() {}", path: "x.unknownext", line: 1 })
    ).toBeNull();
  });
});
