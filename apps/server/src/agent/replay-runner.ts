import type { AgentHarnessEvent, AgentMessage } from "@sakti-code/agent";
import type { WsHandle } from "./ws-handler.ts";

export interface ReplayEntry {
  id: string;
  message?: AgentMessage;
  parentId: string | null;
  timestamp: string;
  type: string;
}

export interface ReplayOptions {
  toolDelayMs?: number;
  wordDelayMs?: number;
}

function splitIntoChunks(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [text];
}

function isMessageEntry(entry: ReplayEntry): entry is ReplayEntry & { message: AgentMessage } {
  return entry.type === "message" && entry.message !== undefined;
}

function getMessageContent(message: AgentMessage): unknown[] {
  if ("content" in message) {
    const content = (message as { content: unknown }).content;
    return Array.isArray(content) ? content : [];
  }
  return [];
}

export class ReplayRunner {
  private readonly entries: ReplayEntry[];
  private readonly ws: WsHandle;
  private readonly sessionId: string;
  private readonly options: ReplayOptions;
  private paused = false;
  private aborted = false;
  private pauseResolve: (() => void) | null = null;

  constructor(
    entries: ReplayEntry[],
    ws: WsHandle,
    sessionId: string,
    options: ReplayOptions = {},
  ) {
    this.entries = entries;
    this.ws = ws;
    this.sessionId = sessionId;
    this.options = options;
  }

  async run(): Promise<void> {
    this.emit({ type: "agent_start" } as AgentHarnessEvent);

    const messageEntries = this.entries.filter(isMessageEntry);
    let i = 0;

    while (i < messageEntries.length) {
      if (this.aborted) {
        break;
      }
      await this.checkPause();

      const entry = messageEntries.at(i);
      if (!entry) {
        break;
      }

      if (entry.message.role === "user") {
        await this.emitUserMessage(entry.message);
        i++;
      } else if (entry.message.role === "assistant") {
        i = await this.emitAssistantTurn(messageEntries, i);
      } else {
        i++;
      }
    }

    this.emit({ type: "agent_end", messages: [] } as AgentHarnessEvent);
  }

  private emitUserMessage(message: AgentMessage): void {
    this.emit({ type: "message_start", message } as AgentHarnessEvent);
    this.emit({ type: "message_end", message } as AgentHarnessEvent);
  }

  private async emitAssistantTurn(
    entries: Array<ReplayEntry & { message: AgentMessage }>,
    startIndex: number,
  ): Promise<number> {
    const entry = entries.at(startIndex);
    if (!entry) {
      return startIndex;
    }
    const message = entry.message;
    const content = getMessageContent(message);

    this.emit({ type: "turn_start" } as AgentHarnessEvent);

    const emptyMsg = { ...message, content: [] } as AgentMessage;
    this.emit({
      type: "message_start",
      message: emptyMsg,
    } as AgentHarnessEvent);

    for (const part of content) {
      if (part !== null && typeof part === "object" && "type" in part && part.type === "thinking") {
        const thinking = (part as { thinking?: string }).thinking ?? "";
        await this.streamDeltas("thinking", thinking);
      }
    }

    for (const part of content) {
      if (part !== null && typeof part === "object" && "type" in part && part.type === "text") {
        const text = (part as { text?: string }).text ?? "";
        await this.streamDeltas("text", text);
      }
    }

    this.emit({ type: "message_end", message } as AgentHarnessEvent);

    for (const part of content) {
      if (part !== null && typeof part === "object" && "type" in part && part.type === "toolCall") {
        const tc = part as unknown as {
          id: string;
          name: string;
          arguments: Record<string, unknown>;
        };
        this.emit({
          type: "tool_execution_start",
          toolCallId: tc.id,
          toolName: tc.name,
          args: tc.arguments,
        } as AgentHarnessEvent);
      }
    }

    let i = startIndex + 1;
    while (i < entries.length) {
      const toolResultEntry = entries.at(i);
      if (toolResultEntry?.message.role !== "toolResult") {
        break;
      }
      await this.checkPause();
      if (this.aborted) {
        break;
      }

      const toolResult = toolResultEntry.message as AgentMessage & {
        content: unknown;
        details?: unknown;
        isError?: boolean;
        toolCallId: string;
        toolName: string;
      };

      const resultContent = Array.isArray(toolResult.content)
        ? toolResult.content
        : [{ type: "text" as const, text: String(toolResult.content) }];

      this.emit({
        type: "tool_execution_end",
        toolCallId: toolResult.toolCallId,
        toolName: toolResult.toolName,
        result: {
          content: resultContent,
          ...(toolResult.details === undefined ? {} : { details: toolResult.details }),
        },
        isError: toolResult.isError ?? false,
      } as AgentHarnessEvent);

      const delay = this.options.toolDelayMs ?? 300;
      if (delay > 0) {
        await this.delay(delay);
      }
      i++;
    }

    this.emit({
      type: "turn_end",
      message,
      toolResults: [],
    } as AgentHarnessEvent);
    return i;
  }

  private async streamDeltas(deltaType: "thinking" | "text", text: string): Promise<void> {
    const chunks = splitIntoChunks(text);
    const delay = this.options.wordDelayMs ?? 15;

    for (const chunk of chunks) {
      if (this.aborted) {
        return;
      }
      await this.checkPause();

      this.emit({
        type: "message_update",
        delta: { kind: deltaType, text: chunk },
      } as AgentHarnessEvent);

      if (delay > 0) {
        await this.delay(delay);
      }
    }
  }

  private emit(event: AgentHarnessEvent): void {
    this.ws.send({ type: "event", sessionId: this.sessionId, event });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async checkPause(): Promise<void> {
    while (this.paused && !this.aborted) {
      await new Promise<void>((resolve) => {
        this.pauseResolve = resolve;
      });
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.pauseResolve?.();
    this.pauseResolve = null;
  }

  abort(): void {
    this.aborted = true;
    this.resume();
  }
}
