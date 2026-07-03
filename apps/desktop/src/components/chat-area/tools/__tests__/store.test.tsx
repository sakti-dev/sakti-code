import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  clearToolRegistry,
  getToolDescriptor,
  isExploreTool,
  normalizeToolName,
  registerTool,
  type ToolDescriptor,
} from "../store.tsx";

describe("tool registry mechanics", () => {
  beforeEach(() => clearToolRegistry());

  it("registerTool throws without a canonical name", () => {
    expect(() =>
      registerTool({ names: [], icon: () => null as never, summary: () => "" } as ToolDescriptor),
    ).toThrow();
  });

  it("normalizeToolName resolves aliases to canonical", () => {
    registerTool({
      names: ["read", "file_read", "view_file"],
      group: "explore",
      icon: () => null as never,
      summary: () => "",
    });
    expect(normalizeToolName("read")).toBe("read");
    expect(normalizeToolName("file_read")).toBe("read");
    expect(normalizeToolName("view_file")).toBe("read");
  });

  it("normalizeToolName returns raw for unknown, 'unknown' for undefined", () => {
    expect(normalizeToolName("mystery")).toBe("mystery");
    expect(normalizeToolName(undefined)).toBe("unknown");
  });

  it("getToolDescriptor returns the match", () => {
    const d: ToolDescriptor = { names: ["bash"], icon: () => null as never, summary: () => "x" };
    registerTool(d);
    expect(getToolDescriptor("bash")).toBe(d);
  });

  it("getToolDescriptor returns the generic fallback (never undefined) for unknown", () => {
    const d = getToolDescriptor("nope");
    expect(d).toBeDefined();
    expect(typeof d.summary).toBe("function");
    expect(d.summary({ tool: "nope", args: {} })).toBe("Used nope");
  });

  it("isExploreTool reads descriptor.group", () => {
    registerTool({
      names: ["grep"],
      group: "explore",
      icon: () => null as never,
      summary: () => "",
    });
    registerTool({ names: ["bash"], icon: () => null as never, summary: () => "" });
    expect(isExploreTool("grep")).toBe(true);
    expect(isExploreTool("bash")).toBe(false);
    expect(isExploreTool("unknown")).toBe(false);
  });

  it("clearToolRegistry empties the registry", () => {
    registerTool({ names: ["bash"], icon: () => null as never, summary: () => "" });
    expect(normalizeToolName("bash")).toBe("bash");
    clearToolRegistry();
    expect(normalizeToolName("bash")).toBe("bash");
  });
});
