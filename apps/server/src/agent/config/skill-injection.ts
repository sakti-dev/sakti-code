import type { AgentMessage } from "@sakti-code/agent";
import type { Skill } from "@sakti-code/agent";

/**
 * Build the synthetic `[AssistantMessage with toolCall, ToolResultMessage]`
 * pair that force-loads a skill's SKILL.md as if the agent had called `read`
 * itself.
 *
 * The pair is prepended to the user's first message at run start. It is
 * ephemeral (in-memory only, never persisted to DB) — re-built every run
 * from the current phase + on-disk SKILL.md content.
 *
 * The toolCall uses a stable synthetic id (`skill-read:<skillName>`) so the
 * matching toolResult can reference it deterministically.
 */
export function buildSkillInjectionMessages(skill: Skill | undefined): AgentMessage[] {
  if (!skill) return [];

  const toolCallId = `skill-read:${skill.name}`;
  const now = Date.now();

  const assistantMessage: AgentMessage = {
    api: "synthetic",
    content: [
      {
        type: "toolCall",
        id: toolCallId,
        name: "read",
        arguments: { filePath: skill.filePath },
      },
    ],
    model: "synthetic",
    provider: "synthetic",
    role: "assistant",
    stopReason: "toolUse",
    timestamp: now,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: {
        cacheRead: 0,
        cacheWrite: 0,
        input: 0,
        output: 0,
        total: 0,
      },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  };

  const toolResultMessage: AgentMessage = {
    content: [{ type: "text", text: skill.content }],
    isError: false,
    role: "toolResult",
    timestamp: now + 1,
    toolCallId,
    toolName: "read",
  };

  return [assistantMessage, toolResultMessage];
}
