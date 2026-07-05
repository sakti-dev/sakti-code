import type { AgentTool } from "@sakti-code/agent";
import { composeSystemPrompt } from "@sakti-code/agent";
import { describe, expect, it } from "vite-plus/test";
import { SKILLS_INSTRUCTIONS } from "../config/index.ts";
import {
  BASE_PROMPT,
  BUILD_PROMPT,
  EXPLORE_PROMPT,
  GENERAL_PROMPT,
  INTAKE_SYSTEM_PROMPT,
  SPEC_PROMPT,
} from "../config/prompts.ts";

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
      "Edit files using hashline patches. Use SWAP N.=M: to replace lines.",
    );
    const readTool = mockTool("read", "Read a file from the local filesystem.");

    const prompt = composeSystemPrompt(
      "You are a coding agent.",
      [editTool, readTool],
      [],
      true,
      SKILLS_INSTRUCTIONS,
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
    const activeTools = allTools.filter((t) => activeToolNames.includes(t.name));

    const prompt = composeSystemPrompt("Base.", activeTools, [], false, SKILLS_INSTRUCTIONS);
    expect(prompt).toContain("# Tool: read");
    expect(prompt).toContain("# Tool: bash");
    expect(prompt).not.toContain("# Tool: edit");
  });

  it("composes intake prompt with tool inventory but no skills", () => {
    const intakeBase = "You are the project's intake agent.";
    const tools = [mockTool("read", "Read."), mockTool("ask", "Ask the user.")];
    const prompt = composeSystemPrompt(intakeBase, tools, [], false, SKILLS_INSTRUCTIONS);
    expect(prompt).toContain(intakeBase);
    expect(prompt).toContain("# Tool: ask");
    expect(prompt).not.toContain("<available_skills>");
  });
});

describe("base + agent section composition", () => {
  it("BUILD_PROMPT starts with BASE_PROMPT", () => {
    expect(BUILD_PROMPT.startsWith(BASE_PROMPT)).toBe(true);
  });

  it("SPEC_PROMPT starts with BASE_PROMPT", () => {
    expect(SPEC_PROMPT.startsWith(BASE_PROMPT)).toBe(true);
  });

  it("INTAKE_SYSTEM_PROMPT starts with BASE_PROMPT", () => {
    expect(INTAKE_SYSTEM_PROMPT.startsWith(BASE_PROMPT)).toBe(true);
  });

  it("EXPLORE_PROMPT starts with BASE_PROMPT", () => {
    expect(EXPLORE_PROMPT.startsWith(BASE_PROMPT)).toBe(true);
  });

  it("GENERAL_PROMPT starts with BASE_PROMPT", () => {
    expect(GENERAL_PROMPT.startsWith(BASE_PROMPT)).toBe(true);
  });

  it("BUILD_PROMPT contains build-specific section after base", () => {
    const section = BUILD_PROMPT.slice(BASE_PROMPT.length);
    expect(section).toContain("Build agent");
    expect(section).toContain('ask({ kind: "completion"');
  });

  it("SPEC_PROMPT contains spec-specific section after base", () => {
    const section = SPEC_PROMPT.slice(BASE_PROMPT.length);
    expect(section).toContain("Spec agent");
    expect(section).toContain('ask({ kind: "spec"');
  });

  it("INTAKE_SYSTEM_PROMPT contains intake-specific section after base", () => {
    const section = INTAKE_SYSTEM_PROMPT.slice(BASE_PROMPT.length);
    expect(section).toContain("Intake agent");
    expect(section).toContain('ask({ kind: "session"');
  });

  it("BASE_PROMPT contains tone and style guidance", () => {
    expect(BASE_PROMPT).toContain("Tone and style");
    expect(BASE_PROMPT).toContain("concise");
  });

  it("BASE_PROMPT contains following conventions guidance", () => {
    expect(BASE_PROMPT).toContain("Following conventions");
  });

  it("BASE_PROMPT contains doing tasks guidance", () => {
    expect(BASE_PROMPT).toContain("Doing tasks");
    expect(BASE_PROMPT).toContain("lint");
  });

  it("BASE_PROMPT contains tool usage policy", () => {
    expect(BASE_PROMPT).toContain("Tool usage policy");
    expect(BASE_PROMPT).toContain("parallel");
  });

  it("BASE_PROMPT contains code references with file:line example", () => {
    expect(BASE_PROMPT).toContain("Code references");
    expect(BASE_PROMPT).toContain("file_path:line_number");
  });
});
