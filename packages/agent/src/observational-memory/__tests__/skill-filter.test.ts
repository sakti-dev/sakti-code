import type { AssistantMessage, ToolResultMessage } from "@sakti-code/llm";
import { describe, expect, it } from "vite-plus/test";
import type { MessageEntry } from "../../session/entries.ts";
import { filterSkillContentEntries } from "../skill-filter.ts";

const SKILL_ROOT = "/home/.sakti/agent/skills";

function makeEntry(id: string, message: MessageEntry["message"]): MessageEntry {
  return { id, parentId: null, timestamp: new Date().toISOString(), type: "message", message };
}

function userMsg(text: string) {
  return { role: "user" as const, content: text, timestamp: Date.now() };
}

function assistantReadMsg(callId: string, filePath: string): AssistantMessage {
  return {
    api: "synthetic",
    content: [{ type: "toolCall", id: callId, name: "read", arguments: { filePath } }],
    model: "synthetic",
    provider: "synthetic",
    role: "assistant",
    stopReason: "toolUse",
    timestamp: Date.now(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  };
}

function toolResultMsg(callId: string, text: string): ToolResultMessage {
  return {
    content: [{ type: "text", text }],
    isError: false,
    role: "toolResult",
    timestamp: Date.now() + 1,
    toolCallId: callId,
    toolName: "read",
  };
}

describe("filterSkillContentEntries", () => {
  it("returns entries unchanged when skillRoot is undefined (filter disabled)", () => {
    const entries = [
      makeEntry("e1", userMsg("hello")),
      makeEntry("e2", assistantReadMsg("c1", `${SKILL_ROOT}/sakti-build/SKILL.md`)),
      makeEntry("e3", toolResultMsg("c1", "skill content")),
    ];
    expect(filterSkillContentEntries(entries, undefined)).toBe(entries);
  });

  it("drops tool-results from skill reads when skillRoot is set", () => {
    const entries = [
      makeEntry("e1", userMsg("do stuff")),
      makeEntry("e2", assistantReadMsg("c-skill", `${SKILL_ROOT}/sakti-build/SKILL.md`)),
      makeEntry("e3", toolResultMsg("c-skill", "INJECTED_SKILL_CONTENT")),
      makeEntry("e4", assistantReadMsg("c-src", "/project/src/file.ts")),
      makeEntry("e5", toolResultMsg("c-src", "source code")),
    ];
    const filtered = filterSkillContentEntries(entries, SKILL_ROOT);
    const ids = filtered.map((e) => e.id);
    expect(ids).not.toContain("e3");
    expect(ids).toContain("e5");
  });

  it("keeps non-read tool-results", () => {
    const grepAssistant: AssistantMessage = {
      ...assistantReadMsg("c-grep", "/project/file.ts"),
      content: [{ type: "toolCall", id: "c-grep", name: "grep", arguments: { pattern: "foo" } }],
    };
    const entries = [
      makeEntry("e1", grepAssistant),
      makeEntry("e2", toolResultMsg("c-grep", "grep output")),
    ];
    const filtered = filterSkillContentEntries(entries, SKILL_ROOT);
    expect(filtered).toHaveLength(2);
  });

  it("keeps user messages, drops skill-read assistant+toolResult pair", () => {
    const entries = [
      makeEntry("e1", userMsg("hello")),
      makeEntry("e2", assistantReadMsg("c1", `${SKILL_ROOT}/sakti-plan/SKILL.md`)),
      makeEntry("e3", toolResultMsg("c1", "plan content")),
    ];
    const filtered = filterSkillContentEntries(entries, SKILL_ROOT);
    const ids = filtered.map((e) => e.id);
    expect(ids).toContain("e1");
    expect(ids).not.toContain("e2");
    expect(ids).not.toContain("e3");
  });

  it("handles assistant messages without tool calls gracefully", () => {
    const textAssistant: AssistantMessage = {
      api: "synthetic",
      content: [{ type: "text", text: "I am helping" }],
      model: "synthetic",
      provider: "synthetic",
      role: "assistant",
      stopReason: "stop",
      timestamp: Date.now(),
      usage: {
        cacheRead: 0,
        cacheWrite: 0,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
        input: 0,
        output: 0,
        totalTokens: 0,
      },
    };
    const entries = [makeEntry("e1", textAssistant)];
    const filtered = filterSkillContentEntries(entries, SKILL_ROOT);
    expect(filtered).toHaveLength(1);
  });

  it("also drops the assistant toolCall entry when all its calls target skillRoot", () => {
    const entries = [
      makeEntry("e1", userMsg("do stuff")),
      makeEntry("e2", assistantReadMsg("c-skill", `${SKILL_ROOT}/sakti-build/SKILL.md`)),
      makeEntry("e3", toolResultMsg("c-skill", "skill content")),
      makeEntry("e4", assistantReadMsg("c-src", "/project/src/file.ts")),
      makeEntry("e5", toolResultMsg("c-src", "source code")),
    ];
    const filtered = filterSkillContentEntries(entries, SKILL_ROOT);
    const ids = filtered.map((e) => e.id);
    expect(ids).not.toContain("e2");
    expect(ids).not.toContain("e3");
    expect(ids).toContain("e4");
    expect(ids).toContain("e5");
  });

  it("keeps assistant entries that have text content alongside skill-read toolCalls", () => {
    const mixedAssistant: AssistantMessage = {
      ...assistantReadMsg("c-mixed", `${SKILL_ROOT}/sakti-build/SKILL.md`),
      content: [
        { type: "text", text: "Let me read the skill first." },
        {
          type: "toolCall",
          id: "c-mixed",
          name: "read",
          arguments: { filePath: `${SKILL_ROOT}/sakti-build/SKILL.md` },
        },
      ],
    };
    const entries = [
      makeEntry("e1", userMsg("do stuff")),
      makeEntry("e2", mixedAssistant),
      makeEntry("e3", toolResultMsg("c-mixed", "skill content")),
    ];
    const filtered = filterSkillContentEntries(entries, SKILL_ROOT);
    const ids = filtered.map((e) => e.id);
    expect(ids).toContain("e2");
    expect(ids).not.toContain("e3");
  });
});
