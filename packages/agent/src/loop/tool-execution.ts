import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  AgentToolResult,
  SessionStore,
} from "../types.ts";
import type { ToolCallInfo } from "./events.ts";
import { evt } from "./events.ts";

export interface ToolExecResult {
  shouldTerminate: boolean;
  toolResultMessages: Extract<AgentMessage, { role: "tool" }>[];
}

export async function* executeToolCalls(
  toolCalls: ToolCallInfo[],
  tools: AgentTool[],
  signal: AbortSignal | undefined,
  store: SessionStore,
  sessionId: string,
  messages: AgentMessage[]
): AsyncGenerator<AgentEvent, ToolExecResult> {
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const toolResultMessages: Extract<AgentMessage, { role: "tool" }>[] = [];
  let shouldTerminate = false;

  for (const tc of toolCalls) {
    const tool = toolMap.get(tc.name);
    let result: AgentToolResult;

    yield evt("tool_execution_start", { toolCallId: tc.id, toolName: tc.name });

    if (tool) {
      let accumulated = "";
      try {
        result = await tool.execute(tc.id, tc.arguments, signal, (partial) => {
          accumulated += partial;
        });
        yield evt("tool_execution_update", {
          toolCallId: tc.id,
          toolName: tc.name,
          accumulated,
        });
      } catch (err: unknown) {
        result = {
          content: err instanceof Error ? err.message : "Tool execution error",
          terminate: false,
          isError: true,
        };
      }
    } else {
      result = {
        content: `Unknown tool: ${tc.name}`,
        terminate: false,
        isError: true,
      };
    }

    yield evt("tool_execution_end", {
      toolCallId: tc.id,
      toolName: tc.name,
      result,
    });

    const toolMsg: Extract<AgentMessage, { role: "tool" }> = {
      role: "tool",
      toolCallId: tc.id,
      toolName: tc.name,
      content: [{ type: "text", text: result.content }],
      isError: result.isError ?? false,
      timestamp: Date.now(),
    };
    messages.push(toolMsg);
    toolResultMessages.push(toolMsg);
    await store.appendMessage(sessionId, toolMsg);

    if (result.terminate) {
      shouldTerminate = true;
    }
  }

  return { toolResultMessages, shouldTerminate };
}
