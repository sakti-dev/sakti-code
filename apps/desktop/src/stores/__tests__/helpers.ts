import type { AgentHarnessEvent, AgentMessage } from "@sakti-code/agent";
import type { AssistantMessage, Usage } from "@sakti-code/llm";

// ── Usage factory ─────────────────────────────────────────────────

export function createMockUsage(
  input = 100,
  output = 50,
  cacheRead = 0,
  cacheWrite = 0
): Usage {
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

// ── Message factories ─────────────────────────────────────────────

export function makeAssistantMessage(
  text: string,
  overrides: Partial<AssistantMessage> = {}
): AssistantMessage {
  return {
    role: "assistant",
    content: text ? [{ type: "text", text }] : [],
    api: "faux",
    provider: "faux",
    model: "faux-1",
    usage: createMockUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
    ...overrides,
  };
}

export function makeUserMessage(text: string): AgentMessage {
  return {
    role: "user",
    content: text,
    timestamp: Date.now(),
  } as AgentMessage;
}

export function makeAssistantMessageWithToolCall(
  text: string,
  toolCall: { id: string; name: string; args: Record<string, unknown> }
): AssistantMessage {
  return {
    ...makeAssistantMessage(text),
    content: [
      ...(text ? [{ type: "text" as const, text }] : []),
      {
        type: "toolCall" as const,
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.args,
      },
    ],
    stopReason: "toolUse",
  };
}

export function makeAssistantMessageWithThinking(
  text: string,
  thinking: string
): AssistantMessage {
  return {
    ...makeAssistantMessage(text),
    content: [
      { type: "thinking" as const, thinking },
      ...(text ? [{ type: "text" as const, text }] : []),
    ],
  };
}

// ── Event factories ───────────────────────────────────────────────

export function makeAgentStartEvent(): AgentHarnessEvent {
  return { type: "agent_start" } as AgentHarnessEvent;
}

export function makeAgentEndEvent(
  messages: AgentMessage[] = []
): AgentHarnessEvent {
  return { type: "agent_end", messages } as AgentHarnessEvent;
}

export function makeTurnStartEvent(): AgentHarnessEvent {
  return { type: "turn_start" } as AgentHarnessEvent;
}

export function makeTurnEndEvent(message: AgentMessage): AgentHarnessEvent {
  return {
    type: "turn_end",
    message,
    toolResults: [],
  } as AgentHarnessEvent;
}

export function makeMessageStartEvent(
  message: AgentMessage
): AgentHarnessEvent {
  return { type: "message_start", message } as AgentHarnessEvent;
}

export function makeMessageUpdateTextDeltaEvent(
  delta: string
): AgentHarnessEvent {
  return {
    type: "message_update",
    delta: { kind: "text", text: delta },
  } as AgentHarnessEvent;
}

export function makeMessageUpdateThinkingDeltaEvent(
  delta: string
): AgentHarnessEvent {
  return {
    type: "message_update",
    delta: { kind: "thinking", text: delta },
  } as AgentHarnessEvent;
}

export function makeMessageEndEvent(message: AgentMessage): AgentHarnessEvent {
  return { type: "message_end", message } as AgentHarnessEvent;
}

export function makeToolExecutionStartEvent(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>
): AgentHarnessEvent {
  return {
    type: "tool_execution_start",
    toolCallId,
    toolName,
    args,
  } as AgentHarnessEvent;
}

export function makeToolExecutionEndEvent(
  toolCallId: string,
  toolName: string,
  result: unknown,
  isError = false
): AgentHarnessEvent {
  return {
    type: "tool_execution_end",
    toolCallId,
    toolName,
    result,
    isError,
  } as AgentHarnessEvent;
}

export function makeAbortEvent(): AgentHarnessEvent {
  return {
    type: "abort",
    clearedFollowUp: [],
    clearedSteer: [],
  } as AgentHarnessEvent;
}

// ── Full lifecycle sequence ───────────────────────────────────────

/**
 * Build a realistic single-turn event sequence:
 * agent_start → turn_start → message_start → text deltas → message_end →
 * tool executions → turn_end → agent_end
 */
export function makeFullTurnSequence(options: {
  text?: string;
  tools?: Array<{
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    result: unknown;
    isError?: boolean;
  }>;
}): AgentHarnessEvent[] {
  const events: AgentHarnessEvent[] = [];
  // message_start fires with an empty streaming message; deltas populate it;
  // message_end fires with the finalized content. Mirror that here so the
  // reducer doesn't double-count the text (extractTextContent + delta append).
  const streamingMsg = makeAssistantMessage("");
  const finalMsg = makeAssistantMessage(options.text ?? "");

  events.push(makeAgentStartEvent());
  events.push(makeTurnStartEvent());
  events.push(makeMessageStartEvent(streamingMsg));

  if (options.text) {
    events.push(makeMessageUpdateTextDeltaEvent(options.text));
  }

  events.push(makeMessageEndEvent(finalMsg));

  for (const tool of options.tools ?? []) {
    events.push(
      makeToolExecutionStartEvent(tool.toolCallId, tool.toolName, tool.args)
    );
    events.push(
      makeToolExecutionEndEvent(
        tool.toolCallId,
        tool.toolName,
        tool.result,
        tool.isError
      )
    );
  }

  events.push(makeTurnEndEvent(finalMsg));
  events.push(makeAgentEndEvent([finalMsg]));

  return events;
}
