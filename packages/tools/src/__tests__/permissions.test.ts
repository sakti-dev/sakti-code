import { describe, expect, it } from "vite-plus/test";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createReadTool,
  createWebFetchTool,
  createWriteTool,
} from "../index.ts";

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
      }),
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

  it("read declares read + the path for directories too", () => {
    const tool = createReadTool("/proj");
    expect(tool.permissions?.({ path: "src" })).toEqual([
      { permission: "read", patterns: ["src"] },
    ]);
  });

  it("webfetch declares webfetch + the url", () => {
    const tool = createWebFetchTool();
    expect(tool.permissions?.({ url: "https://example.com" })).toEqual([
      { permission: "webfetch", patterns: ["https://example.com"] },
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
