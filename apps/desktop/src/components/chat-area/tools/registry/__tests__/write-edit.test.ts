import { describe, expect, it } from "vite-plus/test";
import { editTool } from "../edit.tsx";
import { writeTool } from "../write.tsx";

describe("writeTool", () => {
  it("summarizes as Created <path>", () => {
    expect(writeTool.summary({ tool: "write", args: { path: "/x.ts" } })).toBe("Created /x.ts");
  });
});

describe("editTool", () => {
  it("extracts path from standard args.path", () => {
    expect(editTool.summary({ tool: "edit", args: { path: "/src/index.ts" } })).toContain(
      "index.ts",
    );
  });
  it("extracts path from hashline input [path#HASH]", () => {
    expect(
      editTool.summary({
        tool: "edit",
        args: { input: "[src/foo.ts#1A2B]\nSWAP 1.=2:\n+old\n+new" },
      }),
    ).toContain("foo.ts");
  });
  it("falls back to 'Edited file' when no path", () => {
    expect(editTool.summary({ tool: "edit", args: {} })).toBe("Edited file");
  });
});
