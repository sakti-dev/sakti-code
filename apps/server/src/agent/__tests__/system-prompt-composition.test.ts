import type { AgentTool } from "@sakti-code/agent";
import { composeSystemPrompt } from "@sakti-code/agent";
import { describe, expect, it } from "vitest";
import { SKILLS_INSTRUCTIONS } from "../config/index.ts";

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

describe("runner system prompt composition", () => {
  it("includes the edit tool description when edit is in the toolset", () => {
    const editTool = mockTool(
      "edit",
      "Edit files using hashline patches. Use SWAP N.=M: to replace lines."
    );
    const readTool = mockTool("read", "Read a file from the local filesystem.");

    const prompt = composeSystemPrompt(
      "You are a coding agent.",
      [editTool, readTool],
      [],
      true,
      SKILLS_INSTRUCTIONS
    );

    expect(prompt).toContain("# Tool: edit");
    expect(prompt).toContain("hashline patches");
    expect(prompt).toContain("# Tool: read");
    expect(prompt).toContain("You are a coding agent.");
  });

  it("respects activeToolNames filtering", () => {
    const allTools: AgentTool[] = [
      mockTool("read", "Read."),
      mockTool("edit", "Edit."),
      mockTool("bash", "Bash."),
    ];
    const activeToolNames = ["read", "bash"];
    const activeTools = allTools.filter((t) =>
      activeToolNames.includes(t.name)
    );

    const prompt = composeSystemPrompt(
      "Base.",
      activeTools,
      [],
      false,
      SKILLS_INSTRUCTIONS
    );
    expect(prompt).toContain("# Tool: read");
    expect(prompt).toContain("# Tool: bash");
    expect(prompt).not.toContain("# Tool: edit");
  });

  it("composes intake prompt with tool inventory but no skills", () => {
    const intakeBase = "You are the project's intake agent.";
    const tools = [
      mockTool("read", "Read."),
      mockTool("propose_session", "Propose a session."),
    ];
    const prompt = composeSystemPrompt(
      intakeBase,
      tools,
      [],
      false,
      SKILLS_INSTRUCTIONS
    );
    expect(prompt).toContain(intakeBase);
    expect(prompt).toContain("# Tool: propose_session");
    expect(prompt).not.toContain("<available_skills>");
  });
});
