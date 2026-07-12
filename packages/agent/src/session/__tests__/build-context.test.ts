import { describe, expect, it } from "vite-plus/test";
import type {
  AssistantMessage,
  TextContent,
  ToolCall,
  ToolResultMessage,
  Usage,
} from "@sakti-code/llm";
import type { AgentMessage } from "../../types";
import type {
  ActiveToolsChangeEntry,
  BranchSummaryEntry,
  CustomMessageEntry,
  MessageEntry,
  ModelChangeEntry,
  ObservationEntry,
  ObservationPruneEntry,
  ReflectionEntry,
  SessionTreeEntry,
  ThinkingLevelChangeEntry,
} from "../entries";
import { buildSessionContextFromEntries } from "../session";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let idCounter = 0;
function nextId(): string {
  return `entry-${++idCounter}`;
}

function ts(n: number): string {
  return new Date(1_000_000 + n).toISOString();
}

const USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function userMsg(text: string, n = 0): AgentMessage {
  return { role: "user", content: [{ type: "text", text }], timestamp: 1_000_000 + n };
}

function assistantTextMsg(text: string, n = 0): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "test",
    model: "test-model",
    usage: USAGE,
    stopReason: "stop",
    timestamp: 1_000_000 + n,
  } as AssistantMessage;
}

function toolCall(id: string, name: string, args: Record<string, unknown> = {}): ToolCall {
  return { type: "toolCall", id, name, arguments: args };
}

function assistantWithTools(calls: ToolCall[], text = "", n = 0): AgentMessage {
  const content: (TextContent | ToolCall)[] = [];
  if (text) content.push({ type: "text", text });
  content.push(...calls);
  return {
    role: "assistant",
    content,
    api: "anthropic-messages",
    provider: "test",
    model: "test-model",
    usage: USAGE,
    stopReason: "toolUse",
    timestamp: 1_000_000 + n,
  } as AssistantMessage;
}

function toolResult(callId: string, text: string, n = 0): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: callId,
    toolName: "bash",
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 1_000_000 + n,
  } as ToolResultMessage;
}

function msgEntry(message: AgentMessage, parentId: string | null = null): MessageEntry {
  return {
    id: nextId(),
    parentId,
    timestamp: ts(0),
    type: "message",
    message,
  };
}

/** Build a linear chain of message entries (each parent → child). */
function msgChain(...messages: AgentMessage[]): MessageEntry[] {
  const entries: MessageEntry[] = [];
  let parent: string | null = null;
  for (const m of messages) {
    const e = msgEntry(m, parent);
    entries.push(e);
    parent = e.id;
  }
  return entries;
}

function observationEntry(
  summary: string,
  parentId: string | null = null,
  recordId = "om-record-1",
): ObservationEntry {
  return {
    id: nextId(),
    parentId,
    timestamp: ts(0),
    type: "observation",
    summary,
    observationRecordId: recordId,
  };
}

function reflectionEntry(
  summary: string,
  parentId: string | null = null,
  recordId = "om-record-1",
): ReflectionEntry {
  return {
    id: nextId(),
    parentId,
    timestamp: ts(0),
    type: "reflection",
    summary,
    observationRecordId: recordId,
  };
}

function pruneEntry(
  observedIds: string[],
  parentId: string | null,
  recordId = "om-record-1",
): ObservationPruneEntry {
  return {
    id: nextId(),
    parentId,
    timestamp: ts(0),
    type: "observation_prune",
    observedEntryIds: observedIds,
    observationRecordId: recordId,
  };
}

function thinkingLevelEntry(level: string, parentId: string | null): ThinkingLevelChangeEntry {
  return {
    id: nextId(),
    parentId,
    timestamp: ts(0),
    type: "thinking_level_change",
    thinkingLevel: level,
  };
}

function modelChangeEntry(
  provider: string,
  modelId: string,
  parentId: string | null,
): ModelChangeEntry {
  return { id: nextId(), parentId, timestamp: ts(0), type: "model_change", provider, modelId };
}

function activeToolsEntry(names: string[], parentId: string | null): ActiveToolsChangeEntry {
  return {
    id: nextId(),
    parentId,
    timestamp: ts(0),
    type: "active_tools_change",
    activeToolNames: names,
  };
}

function branchSummaryEntry(
  summary: string,
  fromId: string,
  parentId: string | null,
): BranchSummaryEntry {
  return { id: nextId(), parentId, timestamp: ts(0), type: "branch_summary", summary, fromId };
}

function customMessageEntry(
  customType: string,
  content: string,
  parentId: string | null,
): CustomMessageEntry {
  return {
    id: nextId(),
    parentId,
    timestamp: ts(0),
    type: "custom_message",
    customType,
    content,
    display: true,
  };
}

/** Link entries into a parent→child chain, returning them in sequence order. */
function chain(...entries: SessionTreeEntry[]): SessionTreeEntry[] {
  let parent: string | null = null;
  for (const e of entries) {
    (e as { parentId: string | null }).parentId = parent;
    parent = e.id;
  }
  return entries;
}

/** Extract roles for quick assertion. */
function roles(messages: AgentMessage[]): string[] {
  return messages.map((m) => m.role);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildSessionContextFromEntries — basic message flow", () => {
  it("returns empty messages for empty entries", () => {
    const result = buildSessionContextFromEntries([]);
    expect(result.messages).toEqual([]);
    expect(result.thinkingLevel).toBe("off");
    expect(result.model).toBeNull();
    expect(result.activeToolNames).toBeNull();
  });

  it("preserves user → assistant message order", () => {
    const entries = msgChain(userMsg("hello"), assistantTextMsg("hi there"));
    const result = buildSessionContextFromEntries(entries);
    expect(roles(result.messages)).toEqual(["user", "assistant"]);
    expect((result.messages[0] as { content: unknown }).content).toEqual([
      { type: "text", text: "hello" },
    ]);
  });

  it("extracts model metadata from assistant messages", () => {
    const entries = msgChain(assistantTextMsg("test"));
    const result = buildSessionContextFromEntries(entries);
    expect(result.model).toEqual({ provider: "test", modelId: "test-model" });
  });

  it("tracks thinking level changes", () => {
    const entries = chain(thinkingLevelEntry("high", null), msgEntry(userMsg("hello")));
    const result = buildSessionContextFromEntries(entries);
    expect(result.thinkingLevel).toBe("high");
  });

  it("tracks model changes", () => {
    const entries = chain(modelChangeEntry("openai", "gpt-4.1", null), msgEntry(userMsg("hello")));
    const result = buildSessionContextFromEntries(entries);
    expect(result.model).toEqual({ provider: "openai", modelId: "gpt-4.1" });
  });

  it("tracks active tool changes", () => {
    const entries = chain(
      activeToolsEntry(["read", "write", "bash"], null),
      msgEntry(userMsg("hello")),
    );
    const result = buildSessionContextFromEntries(entries);
    expect(result.activeToolNames).toEqual(["read", "write", "bash"]);
  });
});

describe("buildSessionContextFromEntries — tool call / result pairing", () => {
  it("preserves assistant(toolCall) → toolResult → toolResult order", () => {
    const entries = msgChain(
      userMsg("run it"),
      assistantWithTools([toolCall("tc_1", "bash"), toolCall("tc_2", "read")]),
      toolResult("tc_1", "output 1"),
      toolResult("tc_2", "output 2"),
    );
    const result = buildSessionContextFromEntries(entries);
    expect(roles(result.messages)).toEqual(["user", "assistant", "toolResult", "toolResult"]);
  });

  it("handles a single tool call → result", () => {
    const entries = msgChain(
      assistantWithTools([toolCall("tc_1", "bash")]),
      toolResult("tc_1", "done"),
    );
    const result = buildSessionContextFromEntries(entries);
    expect(roles(result.messages)).toEqual(["assistant", "toolResult"]);
  });

  it("handles multiple sequential tool call rounds", () => {
    const entries = msgChain(
      assistantWithTools([toolCall("tc_1", "bash")]),
      toolResult("tc_1", "result 1"),
      assistantWithTools([toolCall("tc_2", "read")]),
      toolResult("tc_2", "result 2"),
    );
    const result = buildSessionContextFromEntries(entries);
    expect(roles(result.messages)).toEqual(["assistant", "toolResult", "assistant", "toolResult"]);
  });
});

describe("buildSessionContextFromEntries — observation/reflection deferral", () => {
  it("defers observation between tool calls and their results (single tool call)", () => {
    // Tree: assistant(toolCall) → observation → toolResult
    // Expected: assistant(toolCall) → toolResult → observation
    const assistantMsg = assistantWithTools([toolCall("tc_1", "bash")]);
    const entries = chain(
      msgEntry(assistantMsg),
      observationEntry("observed something"),
      msgEntry(toolResult("tc_1", "done")),
    );
    const result = buildSessionContextFromEntries(entries);
    expect(roles(result.messages)).toEqual(["assistant", "toolResult", "observation"]);
    expect(result.messages[2]!.role).toBe("observation");
  });

  it("defers observation between tool calls and their results (multiple tool calls)", () => {
    // Tree: assistant(2 tool calls) → observation → toolResult → toolResult
    // Expected: assistant → toolResult → toolResult → observation
    const entries = chain(
      msgEntry(assistantWithTools([toolCall("tc_1", "bash"), toolCall("tc_2", "read")])),
      observationEntry("observed"),
      msgEntry(toolResult("tc_1", "r1")),
      msgEntry(toolResult("tc_2", "r2")),
    );
    const result = buildSessionContextFromEntries(entries);
    expect(roles(result.messages)).toEqual([
      "assistant",
      "toolResult",
      "toolResult",
      "observation",
    ]);
  });

  it("defers reflection between tool calls and their results", () => {
    const entries = chain(
      msgEntry(assistantWithTools([toolCall("tc_1", "bash")])),
      reflectionEntry("reflected"),
      msgEntry(toolResult("tc_1", "done")),
    );
    const result = buildSessionContextFromEntries(entries);
    expect(roles(result.messages)).toEqual(["assistant", "toolResult", "reflection"]);
  });

  it("defers multiple observations between tool calls and results", () => {
    const entries = chain(
      msgEntry(assistantWithTools([toolCall("tc_1", "bash"), toolCall("tc_2", "read")])),
      observationEntry("obs 1"),
      observationEntry("obs 2"),
      msgEntry(toolResult("tc_1", "r1")),
      msgEntry(toolResult("tc_2", "r2")),
    );
    const result = buildSessionContextFromEntries(entries);
    expect(roles(result.messages)).toEqual([
      "assistant",
      "toolResult",
      "toolResult",
      "observation",
      "observation",
    ]);
  });

  it("places observation normally when no tool calls are pending", () => {
    const entries = chain(
      msgEntry(userMsg("hello")),
      observationEntry("observed"),
      msgEntry(assistantTextMsg("response")),
    );
    const result = buildSessionContextFromEntries(entries);
    expect(roles(result.messages)).toEqual(["user", "observation", "assistant"]);
  });

  it("places observation between two independent turns (no pending tool calls)", () => {
    const entries = chain(
      msgEntry(assistantWithTools([toolCall("tc_1", "bash")])),
      msgEntry(toolResult("tc_1", "done")),
      observationEntry("observation after tool results"),
      msgEntry(assistantTextMsg("final answer")),
    );
    const result = buildSessionContextFromEntries(entries);
    expect(roles(result.messages)).toEqual(["assistant", "toolResult", "observation", "assistant"]);
  });

  it("flushes deferred observations before the next assistant turn", () => {
    // assistant(toolCall) → observation → toolResult → assistant(text)
    // Expected: assistant → toolResult → observation → assistant
    const entries = chain(
      msgEntry(assistantWithTools([toolCall("tc_1", "bash")])),
      observationEntry("observed"),
      msgEntry(toolResult("tc_1", "done")),
      msgEntry(assistantTextMsg("next turn")),
    );
    const result = buildSessionContextFromEntries(entries);
    expect(roles(result.messages)).toEqual(["assistant", "toolResult", "observation", "assistant"]);
  });

  it("flushes remaining deferred observations at the end of the tree", () => {
    // assistant(toolCall) → observation → toolResult → observation (never resolved)
    const entries = chain(
      msgEntry(assistantWithTools([toolCall("tc_1", "bash")])),
      observationEntry("obs 1"),
      msgEntry(toolResult("tc_1", "done")),
      observationEntry("obs 2 at end"),
    );
    const result = buildSessionContextFromEntries(entries);
    expect(roles(result.messages)).toEqual([
      "assistant",
      "toolResult",
      "observation",
      "observation",
    ]);
  });

  it("defers user messages between tool calls and results", () => {
    // A user message (e.g. steering) that lands between tool calls and results
    // should also be deferred to not break the pairing.
    const entries = chain(
      msgEntry(assistantWithTools([toolCall("tc_1", "bash"), toolCall("tc_2", "read")])),
      msgEntry(userMsg("steering message")),
      msgEntry(toolResult("tc_1", "r1")),
      msgEntry(toolResult("tc_2", "r2")),
    );
    const result = buildSessionContextFromEntries(entries);
    expect(roles(result.messages)).toEqual(["assistant", "toolResult", "toolResult", "user"]);
  });

  it("handles interleaved tool call rounds with observations", () => {
    // Round 1: assistant(tc1) → obs → toolResult(tc1)
    // Round 2: assistant(tc2) → obs → toolResult(tc2)
    const entries = chain(
      msgEntry(assistantWithTools([toolCall("tc_1", "bash")])),
      observationEntry("obs 1"),
      msgEntry(toolResult("tc_1", "r1")),
      msgEntry(assistantWithTools([toolCall("tc_2", "read")])),
      observationEntry("obs 2"),
      msgEntry(toolResult("tc_2", "r2")),
    );
    const result = buildSessionContextFromEntries(entries);
    expect(roles(result.messages)).toEqual([
      "assistant",
      "toolResult",
      "observation", // round 1 (obs deferred to after result)
      "assistant",
      "toolResult",
      "observation", // round 2
    ]);
  });
});

describe("buildSessionContextFromEntries — observation pruning", () => {
  it("skips messages in the latest observation_prune set", () => {
    const user1 = msgEntry(userMsg("msg 1"));
    const assistant1 = msgEntry(assistantTextMsg("reply 1"));
    const user2 = msgEntry(userMsg("msg 2"));
    const prune = pruneEntry([user1.id, assistant1.id], null);
    const user3 = msgEntry(userMsg("msg 3"));
    const entries = chain(user1, assistant1, user2, prune, user3);

    const result = buildSessionContextFromEntries(entries);
    // user1 and assistant1 are pruned; user2 and user3 remain
    expect(roles(result.messages)).toEqual(["user", "user"]);
  });

  it("uses the LATEST prune entry (not earlier ones)", () => {
    const user1 = msgEntry(userMsg("msg 1"));
    const prune1 = pruneEntry([user1.id], null);
    const user2 = msgEntry(userMsg("msg 2"));
    const prune2 = pruneEntry(["nonexistent-id"], null); // latest prune: set with no matching entries
    const user3 = msgEntry(userMsg("msg 3"));
    const entries = chain(user1, prune1, user2, prune2, user3);

    const result = buildSessionContextFromEntries(entries);
    // prune2 is latest → its set doesn't contain user1, so user1 is NOT pruned
    expect(roles(result.messages)).toEqual(["user", "user", "user"]);
  });

  it("pruning interacts correctly with tool call deferral", () => {
    // assistant(toolCall) → toolResult → observation_prune(prunes toolResult)
    // The tool result is pruned away, so the assistant has 0 answered tool calls.
    const assistant = msgEntry(assistantWithTools([toolCall("tc_1", "bash")]));
    const result1 = msgEntry(toolResult("tc_1", "done"));
    const prune = pruneEntry([result1.id], null);
    const user = msgEntry(userMsg("next"));
    const entries = chain(assistant, result1, prune, user);

    const result = buildSessionContextFromEntries(entries);
    // toolResult is pruned, so only assistant + user remain
    expect(roles(result.messages)).toEqual(["assistant", "user"]);
  });
});

describe("buildSessionContextFromEntries — special entry types", () => {
  it("renders branch_summary entries as branchSummary messages", () => {
    const user1 = msgEntry(userMsg("hello"));
    const summary = branchSummaryEntry("branch summary", user1.id, null);
    const entries = chain(user1, summary);
    const result = buildSessionContextFromEntries(entries);
    expect(result.messages[1]!.role).toBe("branchSummary");
  });

  it("renders custom_message entries as custom messages", () => {
    const entries = chain(
      msgEntry(userMsg("hello")),
      customMessageEntry("custom-type", "custom content", null),
    );
    const result = buildSessionContextFromEntries(entries);
    expect(result.messages[1]!.role).toBe("custom");
  });

  it("renders observation entries as observation messages when no tool calls pending", () => {
    const entries = chain(msgEntry(userMsg("hello")), observationEntry("an observation"));
    const result = buildSessionContextFromEntries(entries);
    expect(roles(result.messages)).toEqual(["user", "observation"]);
  });

  it("renders reflection entries as reflection messages when no tool calls pending", () => {
    const entries = chain(msgEntry(userMsg("hello")), reflectionEntry("a reflection"));
    const result = buildSessionContextFromEntries(entries);
    expect(roles(result.messages)).toEqual(["user", "reflection"]);
  });

  it("ignores non-message metadata entries (thinking_level, model, tools) in message output", () => {
    const entries = chain(
      thinkingLevelEntry("high", null),
      modelChangeEntry("openai", "gpt-4", null),
      activeToolsEntry(["read"], null),
      msgEntry(userMsg("hello")),
    );
    const result = buildSessionContextFromEntries(entries);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.role).toBe("user");
  });
});

describe("buildSessionContextFromEntries — regression: real-world OM insertion bug", () => {
  it("reproduces and fixes the observation-between-tool-calls bug from session dece9647", () => {
    // Exact scenario from production:
    // 1. assistant message with 2 bash tool calls
    // 2. OM observation entry appended at leaf (while tools executing)
    // 3. tool result for first call
    // 4. tool result for second call
    //
    // Without the fix, the observation appears between (1) and (3),
    // breaking the Anthropic API's tool_call → tool_result pairing.
    const assistantWithCalls = msgEntry(
      assistantWithTools([
        toolCall("call_eed433b5ff644aacb76ae53a", "bash"),
        toolCall("call_3a5137eb514548fe8fbbd8ab", "bash"),
      ]),
    );
    const observation = observationEntry("OM observation injected mid-turn");
    const result1 = msgEntry(toolResult("call_eed433b5ff644aacb76ae53a", "command output 1"));
    const result2 = msgEntry(toolResult("call_3a5137eb514548fe8fbbd8ab", "command output 2"));

    const entries = chain(assistantWithCalls, observation, result1, result2);
    const result = buildSessionContextFromEntries(entries);

    // The tool results MUST immediately follow the assistant message.
    // The observation must be deferred to after both tool results.
    expect(roles(result.messages)).toEqual([
      "assistant", // tool calls
      "toolResult", // first result
      "toolResult", // second result
      "observation", // observation (deferred)
    ]);

    // Verify the tool result toolCallIds match the tool calls
    const assistantContent = result.messages[0] as AssistantMessage;
    const toolCalls = assistantContent.content.filter((c) => c.type === "toolCall");
    expect(toolCalls).toHaveLength(2);

    const toolResults = result.messages.slice(1, 3);
    expect(toolResults[0]!.role).toBe("toolResult");
    expect(toolResults[1]!.role).toBe("toolResult");
  });
});
