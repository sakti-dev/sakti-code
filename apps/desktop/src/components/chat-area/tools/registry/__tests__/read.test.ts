import { describe, expect, it } from "vite-plus/test";
import { readTool } from "../read.tsx";

describe("readTool descriptor", () => {
  it("summarizes a file read", () => {
    expect(readTool.summary({ tool: "read", args: { path: "/a/b.ts" } })).toBe("Read /a/b.ts");
  });
  it("summarizes a directory read as List", () => {
    expect(
      readTool.summary({ tool: "read", args: { path: "/a/b" }, details: { kind: "directory" } }),
    ).toBe("List /a/b");
  });
  it("falls back to unknown path", () => {
    expect(readTool.summary({ tool: "read", args: {} })).toBe("Read unknown");
  });
  it("declares explore group + aliases", () => {
    expect(readTool.group).toBe("explore");
    expect(readTool.names).toContain("file_read");
  });
});
