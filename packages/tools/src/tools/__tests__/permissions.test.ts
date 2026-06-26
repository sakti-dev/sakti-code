import { describe, expect, it } from "vitest";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from "../../index.ts";

describe("tool permissions declarators", () => {
  it("read declares read + the file path", () => {
    const tool = createReadTool("/proj");
    expect(tool.permissions?.({ path: "src/a.ts" })).toEqual([
      { permission: "read", patterns: ["src/a.ts"] },
    ]);
  });

  it("write declares edit + the file path", () => {
    const tool = createWriteTool("/proj");
    expect(tool.permissions?.({ path: "out.txt", content: "x" })).toEqual([
      { permission: "edit", patterns: ["out.txt"] },
    ]);
  });

  it("edit declares edit + the file path", () => {
    const tool = createEditTool("/proj");
    expect(
      tool.permissions?.({
        path: "out.txt",
        edits: [{ oldText: "a", newText: "b" }],
      })
    ).toEqual([{ permission: "edit", patterns: ["out.txt"] }]);
  });

  it("grep declares grep + the pattern", () => {
    const tool = createGrepTool("/proj");
    expect(tool.permissions?.({ pattern: "TODO" })).toEqual([
      { permission: "grep", patterns: ["TODO"] },
    ]);
  });

  it("find declares glob + the pattern", () => {
    const tool = createFindTool("/proj");
    expect(tool.permissions?.({ pattern: "*.ts" })).toEqual([
      { permission: "glob", patterns: ["*.ts"] },
    ]);
  });

  it("ls declares list + the path (defaulting to * when absent)", () => {
    const tool = createLsTool("/proj");
    expect(tool.permissions?.({ path: "src" })).toEqual([
      { permission: "list", patterns: ["src"] },
    ]);
    expect(tool.permissions?.({})).toEqual([
      { permission: "list", patterns: ["*"] },
    ]);
  });
});

describe("bash permissions declarator", () => {
  it("declares bash + external_directory for an out-of-cwd command", () => {
    const tool = createBashTool("/proj");
    const result = tool.permissions?.({ command: "cat /etc/passwd" });
    expect(result).toContainEqual({
      permission: "bash",
      patterns: ["cat /etc/passwd"],
    });
    expect(result).toContainEqual({
      permission: "external_directory",
      patterns: ["/etc/passwd"],
    });
  });

  it("declares only bash for an in-cwd command", () => {
    const tool = createBashTool("/proj");
    const result = tool.permissions?.({ command: "ls src" });
    expect(result).toEqual([{ permission: "bash", patterns: ["ls src"] }]);
  });
});
