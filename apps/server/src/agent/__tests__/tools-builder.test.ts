import type { AgentTool } from "@sakti-code/agent";
import { describe, expect, it } from "vitest";
import { buildTools } from "../tools-builder";

describe("buildTools", () => {
  it("defaults to hashline mode", () => {
    const tools = buildTools("/tmp");
    const edit = tools.find((t) => t.name === "edit");
    expect(edit).toBeDefined();
    expect(edit!.description).toContain("SWAP");
  });

  it("produces replace-mode edit tool when requested", () => {
    const tools = buildTools("/tmp", "replace");
    const edit = tools.find((t) => t.name === "edit");
    expect(edit).toBeDefined();
    expect(edit!.description).toContain("oldText");
    expect(edit!.description).not.toContain("SWAP");
  });

  it("produces hashline-mode edit tool when requested", () => {
    const tools = buildTools("/tmp", "hashline");
    const edit = tools.find((t) => t.name === "edit");
    expect(edit).toBeDefined();
    expect(edit!.description).toContain("SWAP");
  });

  it("always includes read, write, edit, bash, grep, find, ls", () => {
    const tools = buildTools("/tmp") as AgentTool[];
    const names = tools.map((t) => t.name);
    expect(names).toContain("read");
    expect(names).toContain("write");
    expect(names).toContain("edit");
    expect(names).toContain("bash");
    expect(names).toContain("grep");
    expect(names).toContain("find");
    expect(names).toContain("ls");
  });
});
