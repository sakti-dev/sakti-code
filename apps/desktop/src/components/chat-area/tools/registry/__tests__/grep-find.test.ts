import { describe, expect, it } from "vite-plus/test";
import { findTool } from "../find.tsx";
import { grepTool } from "../grep.tsx";

describe("grepTool", () => {
  it("summarizes pattern + optional path", () => {
    expect(grepTool.summary({ tool: "grep", args: { pattern: "foo" } })).toBe(
      'Searched "foo" using Grep',
    );
    expect(grepTool.summary({ tool: "grep", args: { pattern: "foo", path: "src" } })).toBe(
      'Searched "foo" using Grep in src',
    );
  });
});

describe("findTool", () => {
  it("uses pattern, falls back to glob, then '*'", () => {
    expect(findTool.summary({ tool: "find", args: { pattern: "**/*.ts" } })).toBe(
      "Found files matching **/*.ts",
    );
    expect(findTool.summary({ tool: "find", args: { glob: "**/*.tsx" } })).toBe(
      "Found files matching **/*.tsx",
    );
    expect(findTool.summary({ tool: "find", args: {} })).toBe("Found files matching *");
  });
  it("remaps find_by_name alias and declares explore", () => {
    expect(findTool.names).toEqual(["find", "find_by_name"]);
    expect(findTool.group).toBe("explore");
  });
});
