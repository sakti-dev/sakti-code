import { beforeEach, describe, expect, it } from "vite-plus/test";
import { clearToolRegistry, registerTool } from "../store.tsx";
import { extractHashlinePath, extractPath, toToolPartData, type ToolCallPart } from "../shared.ts";

const part = (over: Partial<ToolCallPart> = {}): ToolCallPart => ({
  type: "tool_call",
  toolCallId: "tc1",
  toolName: "read",
  input: { path: "/a/b.ts" },
  status: "done",
  result: "file content",
  details: { kind: "file" },
  ...over,
});

describe("toToolPartData", () => {
  beforeEach(() => clearToolRegistry());

  it("maps input→args, result→output, details→details, toolName→normalized tool", () => {
    const pd = toToolPartData(part());
    expect(pd.args).toEqual({ path: "/a/b.ts" });
    expect(pd.output).toBe("file content");
    expect(pd.details).toEqual({ kind: "file" });
    expect(pd.tool).toBe("read");
  });

  it("forwards reads live (getter), so later mutations are visible", () => {
    const p = part();
    const pd = toToolPartData(p);
    p.result = "changed";
    p.details = { kind: "directory" };
    expect(pd.output).toBe("changed");
    expect(pd.details).toEqual({ kind: "directory" });
  });

  it("normalizes aliases on the tool field", () => {
    registerTool({
      names: ["read", "file_read"],
      icon: () => null as never,
      summary: () => "",
    });
    const pd = toToolPartData(part({ toolName: "file_read" }));
    expect(pd.tool).toBe("read");
  });
});

describe("extractPath", () => {
  it("reads filePath then path", () => {
    expect(extractPath({ args: { filePath: "/x" } })).toBe("/x");
    expect(extractPath({ args: { path: "/y" } })).toBe("/y");
    expect(extractPath({ args: {} })).toBeUndefined();
  });
});

describe("extractHashlinePath", () => {
  it("pulls the path out of [path#HASH] headers", () => {
    expect(extractHashlinePath("[src/foo.ts#1A2B]\nDEL 5")).toBe("src/foo.ts");
    expect(extractHashlinePath("no header here")).toBeUndefined();
  });
});
