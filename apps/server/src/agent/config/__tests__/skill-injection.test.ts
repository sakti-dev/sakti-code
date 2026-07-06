import type { Skill } from "@sakti-code/agent";
import { describe, expect, it } from "vite-plus/test";
import { buildSkillInjectionMessages } from "../skill-injection.ts";

const SKILL: Skill = {
  name: "sakti-build",
  description: "Phase 3 build skill.",
  content: "# Sakti Build\n\nExecute the tasks...",
  filePath: "/home/.sakti/agent/skills/sakti-build/SKILL.md",
};

describe("buildSkillInjectionMessages", () => {
  it("returns an empty array when skill is undefined", () => {
    expect(buildSkillInjectionMessages(undefined)).toEqual([]);
  });

  it("returns two messages: assistant with toolCall + toolResult", () => {
    const msgs = buildSkillInjectionMessages(SKILL);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe("assistant");
    expect(msgs[1]!.role).toBe("toolResult");
  });

  it("assistant message contains a read toolCall with the skill filePath", () => {
    const msgs = buildSkillInjectionMessages(SKILL);
    const assistant = msgs[0]!;
    expect(assistant.role).toBe("assistant");
    if (assistant.role !== "assistant") return;
    const toolCallBlock = assistant.content.find(
      (b): b is Extract<typeof b, { type: "toolCall" }> => b.type === "toolCall",
    );
    expect(toolCallBlock).toBeDefined();
    expect(toolCallBlock!.name).toBe("read");
    expect(toolCallBlock!.arguments.filePath).toBe(SKILL.filePath);
  });

  it("toolResult contains the skill content as text", () => {
    const msgs = buildSkillInjectionMessages(SKILL);
    const toolResult = msgs[1]!;
    expect(toolResult.role).toBe("toolResult");
    if (toolResult.role !== "toolResult") return;
    const textBlock = toolResult.content.find((b) => b.type === "text");
    expect(textBlock).toBeDefined();
    expect((textBlock as { text: string }).text).toContain("# Sakti Build");
  });

  it("toolResult references the assistant toolCall id", () => {
    const msgs = buildSkillInjectionMessages(SKILL);
    const assistant = msgs[0]!;
    const toolResult = msgs[1]!;
    if (assistant.role !== "assistant" || toolResult.role !== "toolResult") return;
    const toolCallBlock = assistant.content.find(
      (b): b is Extract<typeof b, { type: "toolCall" }> => b.type === "toolCall",
    );
    expect(toolResult.toolCallId).toBe(toolCallBlock!.id);
    expect(toolResult.toolName).toBe("read");
  });

  it("uses a stable synthetic toolCall id based on skill name", () => {
    const msgs1 = buildSkillInjectionMessages(SKILL);
    const msgs2 = buildSkillInjectionMessages(SKILL);
    const getCallId = (m: (typeof msgs1)[number]) => {
      if (m.role !== "assistant") return undefined;
      const tc = m.content.find((b) => b.type === "toolCall");
      return tc ? (tc as { id: string }).id : undefined;
    };
    expect(getCallId(msgs1[0]!)).toBe(getCallId(msgs2[0]!));
    expect(getCallId(msgs1[0]!)).toContain("sakti-build");
  });
});
