import { describe, expect, it } from "vitest";
import type { AgentTool } from "../../types";
import { demoteHeaders, renderToolInventory } from "../tool-inventory";

function mockTool(name: string, description: string): AgentTool {
  return {
    name,
    description,
    label: name.charAt(0).toUpperCase() + name.slice(1),
    parameters: { type: "object", properties: {} },
    execute: async () => ({
      content: [{ type: "text", text: "" }],
      details: undefined,
    }),
  } as unknown as AgentTool;
}

describe("demoteHeaders", () => {
  it("returns descriptions with no level-1 headers unchanged", () => {
    const input = "Some description\n## Already level 2";
    expect(demoteHeaders(input)).toBe(input);
  });

  it("demotes level-1 headers to level-2 when present", () => {
    const input = "# Section\nSome text";
    expect(demoteHeaders(input)).toBe("## Section\nSome text");
  });

  it("demotes all ATX headers by one level", () => {
    const input = "# A\n## B\n### C";
    expect(demoteHeaders(input)).toBe("## A\n### B\n#### C");
  });

  it("preserves headers inside fenced code blocks", () => {
    const input = "# Real Header\n```\n# Not A Header\n```";
    const result = demoteHeaders(input);
    expect(result).toContain("## Real Header");
    expect(result).toContain("# Not A Header");
  });

  it("handles mixed fenced and unfenced headers", () => {
    const input = "# Outside\n```\n# Inside\n```\n# Also Outside";
    const result = demoteHeaders(input);
    expect(result).toBe("## Outside\n```\n# Inside\n```\n## Also Outside");
  });

  it("handles tilde-fenced code blocks", () => {
    const input = "# Outside\n~~~\n# Inside\n~~~";
    const result = demoteHeaders(input);
    expect(result).toContain("## Outside");
    expect(result).toContain("# Inside");
  });

  it("returns plain text with no headers unchanged", () => {
    const input = "Just some text\nwith no headers";
    expect(demoteHeaders(input)).toBe(input);
  });

  it("handles empty string", () => {
    expect(demoteHeaders("")).toBe("");
  });
});

describe("renderToolInventory", () => {
  it("returns empty string for empty tool list", () => {
    expect(renderToolInventory([])).toBe("");
  });

  it("renders a single tool with name and description", () => {
    const tool = mockTool("read", "Read a file from the filesystem.");
    const result = renderToolInventory([tool]);
    expect(result).toContain("# Tool: read");
    expect(result).toContain("Read a file from the filesystem.");
  });

  it("sorts tools alphabetically by name", () => {
    const tools = [
      mockTool("write", "Write a file."),
      mockTool("bash", "Run a command."),
      mockTool("edit", "Edit a file."),
    ];
    const result = renderToolInventory(tools);
    const bashIdx = result.indexOf("# Tool: bash");
    const editIdx = result.indexOf("# Tool: edit");
    const writeIdx = result.indexOf("# Tool: write");
    expect(bashIdx).toBeLessThan(editIdx);
    expect(editIdx).toBeLessThan(writeIdx);
  });

  it("separates tool sections with double newline", () => {
    const tools = [mockTool("edit", "Edit."), mockTool("read", "Read.")];
    const result = renderToolInventory(tools);
    expect(result).toContain("# Tool: edit\nEdit.\n\n# Tool: read");
  });

  it("demotes level-1 headers in descriptions", () => {
    const tool = mockTool("edit", "# Syntax\nUse SWAP N.=M:");
    const result = renderToolInventory([tool]);
    expect(result).toContain("## Syntax");
    expect(result).not.toMatch(/^# Syntax/m);
  });

  it("skips tools with empty descriptions but still lists them", () => {
    const tool = mockTool("mystery", "");
    const result = renderToolInventory([tool]);
    expect(result).toContain("# Tool: mystery");
  });

  it("handles tools with multi-line descriptions", () => {
    const tool = mockTool("edit", "Line 1\nLine 2\nLine 3");
    const result = renderToolInventory([tool]);
    expect(result).toContain("Line 1\nLine 2\nLine 3");
  });

  it("preserves code blocks inside descriptions", () => {
    const tool = mockTool("edit", "Example:\n```\nSWAP 1.=1:\n+body\n```");
    const result = renderToolInventory([tool]);
    expect(result).toContain("```\nSWAP 1.=1:\n+body\n```");
  });

  it("renders a realistic edit tool description", () => {
    const desc =
      "Edit files using hashline patches. Line numbers are 1-indexed.\n\nLine ops:\n- SWAP N.=M: replace lines\n- DEL N.=M: delete lines";
    const tool = mockTool("edit", desc);
    const result = renderToolInventory([tool]);
    expect(result).toContain("# Tool: edit");
    expect(result).toContain("hashline patches");
    expect(result).toContain("SWAP N.=M");
  });
});
