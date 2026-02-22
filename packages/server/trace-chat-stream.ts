import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { startServer } from "./src/index.ts";

const workspace = process.cwd();
const prompt = "Read README.md and then answer in one sentence.";

process.env.SAKTI_CODE_PERMISSIONS = JSON.stringify({
  read: "allow",
  edit: "allow",
  bash: "allow",
  external_directory: "allow",
});

function b64(value: string) {
  return Buffer.from(value, "utf-8").toString("base64");
}

const trace: Array<{
  index: number;
  streamType: string;
  streamId?: string;
  toolCallId?: string;
  routedMessage?: string;
  routeReason?: string;
  note?: string;
}> = [];

let index = 0;
let preambleId: string | null = null;
let activityId: string | null = null;
let finalId: string | null = null;
let hasToolCalls = false;
let bufferedText = "";
let msgCounter = 0;

const messageParts: Record<string, string[]> = {};
const messageKind: Record<string, string> = {};

function ensureMessage(kind: "preamble" | "activity" | "final") {
  if (kind === "preamble" && !preambleId) {
    preambleId = `preamble_${++msgCounter}`;
    messageKind[preambleId] = "preamble";
    messageParts[preambleId] = [];
  }
  if (kind === "activity" && !activityId) {
    activityId = `activity_${++msgCounter}`;
    messageKind[activityId] = "activity";
    messageParts[activityId] = [];
  }
  if (kind === "final" && !finalId) {
    finalId = `final_${++msgCounter}`;
    messageKind[finalId] = "final";
    messageParts[finalId] = [];
  }
  return kind === "preamble" ? preambleId : kind === "activity" ? activityId : finalId;
}

function pushTrace(entry: Omit<(typeof trace)[number], "index">) {
  trace.push({ index: ++index, ...entry });
}

function addPart(targetId: string | null, label: string) {
  if (!targetId) return;
  if (!messageParts[targetId]) messageParts[targetId] = [];
  messageParts[targetId].push(label);
}

type StreamCallbacks = {
  onMessageStart?: (messageId: string) => void;
  onTextDelta?: (messageId: string, delta: string) => void;
  onToolCallStart?: (toolCall: { toolCallId: string; toolName: string }) => void;
  onToolCallEnd?: (toolCallId: string, args: unknown) => void;
  onToolResult?: (result: { toolCallId: string; result: unknown }) => void;
  onDataPart?: (type: string, id: string, data: unknown, transient?: boolean) => void;
  onError?: (error: Error) => void;
  onComplete?: (finishReason: string) => void;
};

type StreamPart = {
  type: string;
  id?: string;
  toolCallId?: string;
  toolName?: string;
  delta?: string;
  text?: string;
  args?: unknown;
  result?: unknown;
  data?: unknown;
  transient?: boolean;
  finishReason?: string;
  error?: string;
};

async function parseUIMessageStream(
  response: Response,
  callbacks: StreamCallbacks,
  timeoutMs?: number
) {
  if (!response.body) throw new Error("Response body is null");

  const reader = response.body.getReader();
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const decoder = new TextDecoder();
  let buffer = "";
  let currentMessageId: string | null = null;
  const toolArgsBuffers = new Map<string, string>();
  let completed = false;

  if (typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      try {
        void reader.cancel();
      } catch {
        // ignore
      }
    }, timeoutMs);
  }

  const handleStreamPart = (part: StreamPart) => {
    const type = part.type;
    const id = part.id as string | undefined;

    switch (type) {
      case "message-start":
        if (id) {
          callbacks.onMessageStart?.(id);
          currentMessageId = id;
        }
        return;
      case "text-delta":
      case "text":
        callbacks.onTextDelta?.(
          id || currentMessageId || "",
          (part.delta as string) || (part.text as string) || ""
        );
        return;
      case "tool-input-start":
        callbacks.onToolCallStart?.({
          toolCallId: part.toolCallId as string,
          toolName: part.toolName as string,
        });
        toolArgsBuffers.set(part.toolCallId as string, "");
        return;
      case "tool-input-delta": {
        const toolCallId = part.toolCallId as string;
        const currentArgs = toolArgsBuffers.get(toolCallId) ?? "";
        toolArgsBuffers.set(toolCallId, currentArgs + ((part.delta as string) || ""));
        return;
      }
      case "tool-input-end": {
        const toolCallId = part.toolCallId as string;
        const finalArgs = toolArgsBuffers.get(toolCallId) ?? "{}";
        try {
          callbacks.onToolCallEnd?.(toolCallId, JSON.parse(finalArgs));
        } catch {
          callbacks.onToolCallEnd?.(toolCallId, {});
        }
        toolArgsBuffers.delete(toolCallId);
        return;
      }
      case "tool-call":
        callbacks.onToolCallStart?.({
          toolCallId: part.toolCallId as string,
          toolName: part.toolName as string,
        });
        callbacks.onToolCallEnd?.(part.toolCallId as string, part.args);
        return;
      case "tool-result":
        callbacks.onToolResult?.({
          toolCallId: part.toolCallId as string,
          result: part.result,
        });
        return;
      case "finish":
        callbacks.onComplete?.((part.finishReason as string) || "stop");
        return;
      case "error":
        callbacks.onError?.(new Error((part.error as string) || "Unknown stream error"));
        return;
      default:
        if (type?.startsWith("data-")) {
          callbacks.onDataPart?.(type, id || "", part.data, part.transient);
        }
    }
  };

  const tryParseRawLine = (line: string) => {
    if (line.startsWith("0:")) {
      const text = line.slice(2);
      if (text.startsWith('"') && text.endsWith('"')) {
        try {
          callbacks.onTextDelta?.(currentMessageId || "", JSON.parse(text));
        } catch {
          callbacks.onTextDelta?.(currentMessageId || "", text);
        }
      } else {
        callbacks.onTextDelta?.(currentMessageId || "", text);
      }
      return;
    }

    if (line.startsWith("b:")) {
      try {
        const data = JSON.parse(line.slice(2));
        if (data?.type) handleStreamPart(data);
      } catch {
        // ignore
      }
      return;
    }

    if (line.startsWith("d:")) {
      try {
        const data = JSON.parse(line.slice(2));
        callbacks.onComplete?.((data.finishReason as string) || "stop");
      } catch {
        callbacks.onComplete?.("stop");
      }
      return;
    }

    if (line.startsWith("8:")) {
      try {
        const parts = JSON.parse(line.slice(2));
        if (Array.isArray(parts)) {
          for (const part of parts) {
            if (part?.type?.startsWith("data-")) {
              callbacks.onDataPart?.(part.type, part.id || "", part.data, part.transient);
            }
          }
        }
      } catch {
        // ignore
      }
      return;
    }

    if (line.startsWith("e:")) {
      try {
        const data = JSON.parse(line.slice(2));
        callbacks.onError?.(new Error(data.message || data.error || "Stream error"));
      } catch {
        callbacks.onError?.(new Error("Unknown stream error"));
      }
    }
  };

  try {
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (error) {
        if (timedOut) {
          break;
        }
        throw error;
      }

      const { done, value } = result;
      if (done) {
        if (!completed && !timedOut) {
          callbacks.onComplete?.("stop");
          completed = true;
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;

        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") {
            if (!completed) {
              callbacks.onComplete?.("stop");
              completed = true;
            }
            continue;
          }
          try {
            handleStreamPart(JSON.parse(data));
          } catch {
            tryParseRawLine(line);
          }
        } else {
          tryParseRawLine(line);
        }
      }
    }
    if (timedOut && !completed) {
      callbacks.onComplete?.("timeout");
      completed = true;
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  return { timedOut };
}

const TRACE_TIMEOUT_MS = 30000;

async function run(url: string, headers: Record<string, string>) {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      message: prompt,
      workspace,
      stream: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  try {
    const { timedOut } = await parseUIMessageStream(
      response,
      {
        onMessageStart: messageId => {
          pushTrace({
            streamType: "message-start",
            streamId: messageId,
            note: "stream message started",
          });
        },
        onTextDelta: (messageId, delta) => {
          if (!hasToolCalls) {
            const targetId = ensureMessage("preamble");
            addPart(targetId, `text-delta(${delta.length})`);
            pushTrace({
              streamType: "text-delta",
              streamId: messageId,
              routedMessage: targetId ?? undefined,
              routeReason: "no tool calls yet → preamble",
              note: `deltaLength=${delta.length}`,
            });
          } else {
            bufferedText += delta;
            pushTrace({
              streamType: "text-delta",
              streamId: messageId,
              routedMessage: "(buffered)",
              routeReason: "tool calls already seen → buffer for final",
              note: `deltaLength=${delta.length}`,
            });
          }
        },
        onToolCallStart: toolCall => {
          hasToolCalls = true;
          const targetId = ensureMessage("activity");
          addPart(targetId, `tool-call(${toolCall.toolName})`);
          pushTrace({
            streamType: "tool-call",
            toolCallId: toolCall.toolCallId,
            routedMessage: targetId ?? undefined,
            routeReason: "tool-call → activity message",
            note: `toolName=${toolCall.toolName}`,
          });
        },
        onToolCallEnd: toolCallId => {
          const targetId = ensureMessage("activity");
          addPart(targetId, `tool-call-args(${toolCallId})`);
          pushTrace({
            streamType: "tool-input-end",
            toolCallId,
            routedMessage: targetId ?? undefined,
            routeReason: "tool-call args finalize → activity",
          });
        },
        onToolResult: result => {
          const targetId = ensureMessage("activity");
          addPart(targetId, `tool-result(${result.toolCallId})`);
          pushTrace({
            streamType: "tool-result",
            toolCallId: result.toolCallId,
            routedMessage: targetId ?? undefined,
            routeReason: "tool-result → activity",
          });
        },
        onDataPart: (type, id, _data, transient) => {
          if (type === "data-session") {
            pushTrace({ streamType: type, streamId: id, note: "session metadata" });
            return;
          }

          const isUiData = type.startsWith("data-");
          const targetId = isUiData ? ensureMessage("activity") : ensureMessage("preamble");
          addPart(targetId, `${type}(${id})${transient ? ":transient" : ""}`);

          const reason = isUiData ? "data-* → activity" : "non-data → preamble";
          pushTrace({
            streamType: type,
            streamId: id,
            routedMessage: targetId ?? undefined,
            routeReason: reason,
            note: transient ? "transient" : undefined,
          });
        },
        onComplete: finishReason => {
          if (bufferedText.trim()) {
            const targetId = ensureMessage("final");
            addPart(targetId, `final-text(${bufferedText.length})`);
            pushTrace({
              streamType: "text-final",
              routedMessage: targetId ?? undefined,
              routeReason: "buffer flushed → final message",
              note: `bufferedLength=${bufferedText.length}`,
            });
          }

          pushTrace({ streamType: "finish", note: `finishReason=${finishReason}` });
        },
        onError: error => {
          pushTrace({ streamType: "error", note: error.message });
        },
      },
      TRACE_TIMEOUT_MS
    );
    if (timedOut) {
      pushTrace({ streamType: "timeout", note: `timed out after ${TRACE_TIMEOUT_MS}ms` });
    }
  } catch (error) {
    const err = error as Error;
    pushTrace({ streamType: "error", note: err.message });
  }
}

async function main() {
  const { server, port, token } = await startServer();
  const url = `http://127.0.0.1:${port}/api/chat`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Basic ${b64(`admin:${token}`)}`,
  };

  try {
    await run(url, headers);
  } finally {
    server.close();
  }

  const traceLines = [
    "# Stream Trace",
    `Prompt: ${prompt}`,
    `Workspace: ${workspace}`,
    "",
    "## Stream Order + Routing",
    "| # | streamType | streamId/toolCallId | routedMessage | reason | note |",
    "|---:|---|---|---|---|---|",
    ...trace.map(t => {
      const id = t.toolCallId ?? t.streamId ?? "";
      return `| ${t.index} | ${t.streamType} | ${id} | ${t.routedMessage ?? ""} | ${t.routeReason ?? ""} | ${t.note ?? ""} |`;
    }),
    "",
    "## Message Buckets",
    ...Object.keys(messageParts).map(id => {
      const kind = messageKind[id] ?? "unknown";
      const parts = messageParts[id].map(p => `- ${p}`).join("\n");
      return `### ${id} (${kind})\n${parts}`;
    }),
    "",
  ].join("\n");

  const logsDir = path.resolve(process.cwd(), "logs");
  await mkdir(logsDir, { recursive: true });
  const outPath = path.join(logsDir, `stream-trace-${Date.now()}.md`);
  await writeFile(outPath, traceLines, "utf-8");

  console.log(`Trace written to ${outPath}`);
}

main().catch(error => {
  console.error("Trace failed", error);
  process.exitCode = 1;
});
