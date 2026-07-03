import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  ensureToolsRegistered,
  getToolDescriptor,
  isExploreTool,
  normalizeToolName,
  resetToolRegistry,
} from "../index.ts";

describe("tool registry composition", () => {
  beforeEach(() => resetToolRegistry());

  it("resolves all 9 canonical names", () => {
    ensureToolsRegistered();
    for (const name of [
      "read",
      "write",
      "edit",
      "bash",
      "grep",
      "find",
      "webfetch",
      "websearch",
      "propose_session",
    ]) {
      const d = getToolDescriptor(name);
      expect(d.names[0]).toBe(name);
    }
  });

  it("resolves aliases (incl. find_by_name → find)", () => {
    ensureToolsRegistered();
    expect(normalizeToolName("file_read")).toBe("read");
    expect(normalizeToolName("find_by_name")).toBe("find");
    expect(normalizeToolName("apply_patch")).toBe("edit");
    expect(normalizeToolName("run_command")).toBe("bash");
  });

  it("explore group = read, grep, find only", () => {
    ensureToolsRegistered();
    expect(isExploreTool("read")).toBe(true);
    expect(isExploreTool("grep")).toBe(true);
    expect(isExploreTool("find")).toBe(true);
    expect(isExploreTool("bash")).toBe(false);
    expect(isExploreTool("websearch")).toBe(false);
  });

  it("generic fallback for removed/legacy tools", () => {
    ensureToolsRegistered();
    const glob = getToolDescriptor("glob");
    expect(glob.names).toEqual([]);
    expect(glob.summary({ tool: "glob", args: {} })).toBe("Used glob");
  });

  it("resetToolRegistry allows re-init", () => {
    ensureToolsRegistered();
    resetToolRegistry();
    ensureToolsRegistered();
    expect(getToolDescriptor("read").names[0]).toBe("read");
  });

  it("getToolDescriptor auto-inits (no explicit ensure needed)", () => {
    expect(getToolDescriptor("read").names[0]).toBe("read");
  });
});
