import { describe, expect, it } from "vite-plus/test";
import type { MessagePart } from "~/stores/types.ts";
import { groupTimelineParts } from "../timeline-grouping.ts";

const read = (id: string, file: string): MessagePart => ({
  input: { file_path: file },
  status: "done",
  toolCallId: id,
  toolName: "read",
  type: "tool_call",
});
const grep = (id: string): MessagePart => ({
  input: { pattern: "foo" },
  status: "done",
  toolCallId: id,
  toolName: "grep",
  type: "tool_call",
});
const edit = (id: string): MessagePart => ({
  input: { file_path: "a.ts" },
  status: "done",
  toolCallId: id,
  toolName: "edit",
  type: "tool_call",
});
const bash = (id: string): MessagePart => ({
  input: { command: "npm test" },
  status: "done",
  toolCallId: id,
  toolName: "bash",
  type: "tool_call",
});
const text = (t: string): MessagePart => ({ type: "text", text: t });
const thinking = (t: string): MessagePart => ({ type: "thinking", text: t });

describe("groupTimelineParts", () => {
  it("returns single items for non-explore parts", () => {
    const result = groupTimelineParts([text("hello"), bash("b1"), thinking("hmm")]);
    expect(result).toHaveLength(3);
    expect(result.every((r) => r.kind === "single")).toBe(true);
  });

  it("groups 2+ consecutive explore tools", () => {
    const result = groupTimelineParts([read("r1", "a.ts"), read("r2", "b.ts"), read("r3", "c.ts")]);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("explore");
  });

  it("single explore tool stays as single item", () => {
    const result = groupTimelineParts([read("r1", "a.ts")]);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("single");
  });

  it("non-explore tool breaks the group", () => {
    const result = groupTimelineParts([
      read("r1", "a.ts"),
      read("r2", "b.ts"),
      edit("e1"),
      read("r3", "c.ts"),
      read("r4", "d.ts"),
    ]);
    expect(result).toHaveLength(3);
    expect(result[0]?.kind).toBe("explore");
    expect(result[1]?.kind).toBe("single");
    expect(result[2]?.kind).toBe("explore");
  });

  it("groups mixed explore tools (read + grep + glob)", () => {
    const result = groupTimelineParts([
      read("r1", "a.ts"),
      grep("g1"),
      {
        input: { pattern: "*.ts" },
        status: "done" as const,
        toolCallId: "gl1",
        toolName: "glob",
        type: "tool_call" as const,
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("explore");
  });

  it("text between explore tools breaks the group", () => {
    const result = groupTimelineParts([
      read("r1", "a.ts"),
      read("r2", "b.ts"),
      text("check"),
      read("r3", "c.ts"),
    ]);
    expect(result).toHaveLength(3);
  });

  it("handles empty input", () => {
    expect(groupTimelineParts([])).toEqual([]);
  });

  it("handles aliased tool names (file_read → read)", () => {
    const result = groupTimelineParts([
      {
        input: {},
        status: "done" as const,
        toolCallId: "1",
        toolName: "file_read",
        type: "tool_call" as const,
      },
      {
        input: {},
        status: "done" as const,
        toolCallId: "2",
        toolName: "view_file",
        type: "tool_call" as const,
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("explore");
  });

  it("preserves the exact part references inside groups (no cloning)", () => {
    const r1 = read("r1", "a.ts");
    const r2 = read("r2", "b.ts");
    const result = groupTimelineParts([r1, r2]);
    expect(result[0]?.kind).toBe("explore");
    if (result[0]?.kind === "explore") {
      expect(result[0].parts[0]).toBe(r1);
      expect(result[0].parts[1]).toBe(r2);
    }
  });

  it("preserves the exact part reference for single items (no cloning)", () => {
    const e = edit("e1");
    const result = groupTimelineParts([e]);
    expect(result[0]?.kind).toBe("single");
    if (result[0]?.kind === "single") {
      expect(result[0].part).toBe(e);
    }
  });
});
