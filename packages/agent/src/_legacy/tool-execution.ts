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

function shouldTerminateToolBatch(results: { terminate: boolean }[]): boolean {
  return results.length > 0 && results.every((r) => r.terminate === true);
}

interface FinalizedTool {
  events: AgentEvent[];
  result: AgentToolResult;
  tc: ToolCallInfo;
}

async function executeOneTool(
  tc: ToolCallInfo,
  tool: AgentTool | undefined,
  signal: AbortSignal | undefined
): Promise<FinalizedTool> {
  const events: AgentEvent[] = [];
  let result: AgentToolResult;

  if (tool) {
    let accumulated = "";
    try {
      result = await tool.execute(tc.id, tc.arguments, signal, (partial) => {
        accumulated += partial;
      });
      events.push(
        evt("tool_execution_update", {
          toolCallId: tc.id,
          toolName: tc.name,
          accumulated,
        })
      );
    } catch (err: unknown) {
      let content: string;
      if (accumulated.length > 0) {
        content = accumulated;
      } else if (err instanceof Error) {
        content = err.message;
      } else {
        content = "Tool execution error";
      }
      if (accumulated.length > 0) {
        events.push(
          evt("tool_execution_update", {
            toolCallId: tc.id,
            toolName: tc.name,
            accumulated,
          })
        );
      }
      result = {
        content,
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

  events.push(
    evt("tool_execution_end", {
      toolCallId: tc.id,
      toolName: tc.name,
      result,
    })
  );

  return { events, result, tc };
}

async function persistToolResult(
  finalized: FinalizedTool,
  store: SessionStore,
  sessionId: string,
  messages: AgentMessage[]
): Promise<Extract<AgentMessage, { role: "tool" }>> {
  const { result, tc } = finalized;
  const toolMsg: Extract<AgentMessage, { role: "tool" }> = {
    role: "tool",
    toolCallId: tc.id,
    toolName: tc.name,
    content: [{ type: "text", text: result.content }],
    isError: result.isError ?? false,
    timestamp: Date.now(),
  };
  messages.push(toolMsg);
  await store.appendMessage(sessionId, toolMsg);
  return toolMsg;
}

export async function* executeToolCalls(
  toolCalls: ToolCallInfo[],
  tools: AgentTool[],
  signal: AbortSignal | undefined,
  store: SessionStore,
  sessionId: string,
  messages: AgentMessage[],
  toolExecutionMode: "sequential" | "parallel" = "parallel"
): AsyncGenerator<AgentEvent, ToolExecResult> {
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const toolResultMessages: Extract<AgentMessage, { role: "tool" }>[] = [];
  const terminates: { terminate: boolean }[] = [];

  if (toolExecutionMode === "parallel" && toolCalls.length > 1) {
    yield* executeParallel(
      toolCalls,
      toolMap,
      signal,
      store,
      sessionId,
      messages,
      toolResultMessages,
      terminates
    );
  } else {
    yield* executeSequential(
      toolCalls,
      toolMap,
      signal,
      store,
      sessionId,
      messages,
      toolResultMessages,
      terminates
    );
  }

  return {
    toolResultMessages,
    shouldTerminate: shouldTerminateToolBatch(terminates),
  };
}

async function* executeSequential(
  toolCalls: ToolCallInfo[],
  toolMap: Map<string, AgentTool>,
  signal: AbortSignal | undefined,
  store: SessionStore,
  sessionId: string,
  messages: AgentMessage[],
  toolResultMessages: Extract<AgentMessage, { role: "tool" }>[],
  terminates: { terminate: boolean }[]
): AsyncGenerator<AgentEvent> {
  for (const tc of toolCalls) {
    const tool = toolMap.get(tc.name);
    yield evt("tool_execution_start", {
      toolCallId: tc.id,
      toolName: tc.name,
    });

    const finalized = await executeOneTool(tc, tool, signal);
    for (const e of finalized.events) {
      yield e;
    }
    const toolMsg = await persistToolResult(
      finalized,
      store,
      sessionId,
      messages
    );
    toolResultMessages.push(toolMsg);
    yield evt("message_start", { message: toolMsg });
    yield evt("message_end", { message: toolMsg });
    terminates.push(finalized.result);

    if (signal?.aborted) {
      break;
    }
  }
}

async function* executeParallel(
  toolCalls: ToolCallInfo[],
  toolMap: Map<string, AgentTool>,
  signal: AbortSignal | undefined,
  store: SessionStore,
  sessionId: string,
  messages: AgentMessage[],
  toolResultMessages: Extract<AgentMessage, { role: "tool" }>[],
  terminates: { terminate: boolean }[]
): AsyncGenerator<AgentEvent> {
  const thunks: (() => Promise<FinalizedTool>)[] = [];
  for (const tc of toolCalls) {
    const tool = toolMap.get(tc.name);
    yield evt("tool_execution_start", {
      toolCallId: tc.id,
      toolName: tc.name,
    });
    thunks.push(() => executeOneTool(tc, tool, signal));
    if (signal?.aborted) {
      break;
    }
  }

  const results = await Promise.all(thunks.map((t) => t()));

  for (const finalized of results) {
    for (const e of finalized.events) {
      yield e;
    }
    const toolMsg = await persistToolResult(
      finalized,
      store,
      sessionId,
      messages
    );
    toolResultMessages.push(toolMsg);
    yield evt("message_start", { message: toolMsg });
    yield evt("message_end", { message: toolMsg });
    terminates.push(finalized.result);
  }
}
