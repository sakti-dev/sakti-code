import type { AgentMessage } from "@sakti-code/agent";
import type { DrizzleDB } from "./init.ts";
import { MessageRepo, SessionRepo } from "./repos/index.ts";
import { messages } from "./schema.ts";

export class SqliteSessionStore {
  private readonly db: DrizzleDB;
  private readonly messageRepo: MessageRepo;
  private readonly sessionRepo: SessionRepo;

  constructor(db: DrizzleDB) {
    this.db = db;
    this.messageRepo = new MessageRepo(db);
    this.sessionRepo = new SessionRepo(db);
  }

  // biome-ignore lint/suspicious/useAwait: SessionStore interface requires async; drizzle calls are synchronous
  async loadMessages(sessionId: string): Promise<AgentMessage[]> {
    const rows = this.messageRepo.loadBySession(sessionId);
    return rows.map(mapRowToAgentMessage);
  }

  async appendMessage(sessionId: string, message: AgentMessage): Promise<void> {
    await this.messageRepo.append(sessionId, agentMessageToRow(message));
  }

  async replaceMessages(
    sessionId: string,
    messages: AgentMessage[]
  ): Promise<void> {
    await this.messageRepo.replaceForSession(
      sessionId,
      messages.map(agentMessageToRow)
    );
  }

  async fork(
    sourceSessionId: string,
    upToMessageIndex?: number
  ): Promise<{ sessionId: string }> {
    const sourceSession = this.sessionRepo.findById(sourceSessionId);
    if (!sourceSession) {
      throw new Error("Session not found");
    }

    // Use raw DB rows directly to avoid round-tripping through AgentMessage format
    const allRows = this.messageRepo.loadBySession(sourceSessionId);
    const slicedRows =
      upToMessageIndex === undefined
        ? allRows
        : allRows.slice(0, upToMessageIndex + 1);

    const forkedTitle = sourceSession.title
      ? `Fork of ${sourceSession.title}`
      : "Fork";

    const newSession = await this.sessionRepo.create(
      sourceSession.projectId,
      sourceSession.modelId,
      {
        title: forkedTitle,
        thinkingLevel: sourceSession.thinkingLevel,
        parentSessionId: sourceSessionId,
      }
    );

    // Copy messages in a transaction using raw DB rows (content is already plain text)
    await this.db.transaction(async (tx) => {
      if (slicedRows.length > 0) {
        const now = Date.now();
        await tx.insert(messages).values(
          slicedRows.map((row, i) => ({
            id: crypto.randomUUID(),
            sessionId: newSession.id,
            role: row.role,
            content: row.content,
            toolCalls: row.toolCalls,
            toolCallId: row.toolCallId,
            toolName: row.toolName,
            toolArguments: row.toolArguments,
            isError: row.isError,
            stopReason: row.stopReason,
            errorMessage: row.errorMessage,
            usage: row.usage,
            createdAt: now + i,
          }))
        );
      }
    });

    return { sessionId: newSession.id };
  }
}

function mapRowToAgentMessage(row: {
  role: string;
  content: string;
  toolCalls?: string | null;
  toolCallId?: string | null;
  toolName?: string | null;
  toolArguments?: string | null;
  isError?: number | null;
  stopReason?: string | null;
  errorMessage?: string | null;
  usage?: string | null;
  createdAt: number;
}): AgentMessage {
  const base = { timestamp: row.createdAt };

  if (row.role === "user") {
    return { role: "user", content: row.content, ...base };
  }

  if (row.role === "assistant") {
    const content: Extract<AgentMessage, { role: "assistant" }>["content"] = [];
    // Parse text from content field
    content.push({ type: "text", text: row.content });
    // Parse tool calls if present
    if (row.toolCalls) {
      try {
        const calls = JSON.parse(row.toolCalls) as Array<{
          type: "toolCall";
          id: string;
          name: string;
          arguments: Record<string, unknown>;
        }>;
        content.push(...calls);
      } catch {
        /* ignore parse errors */
      }
    }

    let usage: Extract<AgentMessage, { role: "assistant" }>["usage"];
    if (row.usage) {
      try {
        usage = JSON.parse(row.usage);
      } catch {
        usage = {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        };
      }
    } else {
      usage = {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      };
    }

    return {
      role: "assistant",
      content,
      usage,
      ...base,
      ...(row.stopReason ? { stopReason: row.stopReason } : {}),
      ...(row.errorMessage ? { errorMessage: row.errorMessage } : {}),
    };
  }

  // role === "tool"
  return {
    role: "tool",
    toolCallId: row.toolCallId ?? "",
    toolName: row.toolName ?? "",
    content: [{ type: "text", text: row.content }],
    isError: (row.isError ?? 0) === 1,
    ...base,
  };
}

function agentMessageToRow(msg: AgentMessage): {
  role: string;
  content: string;
  toolCalls?: string;
  toolCallId?: string;
  toolName?: string;
  toolArguments?: string;
  isError?: number;
  stopReason?: string;
  errorMessage?: string;
  usage?: string;
} {
  if (msg.role === "user") {
    return { role: "user", content: msg.content };
  }

  if (msg.role === "assistant") {
    const aMsg = msg as AgentMessage & { role: "assistant" };
    // Extract text content
    const textParts = aMsg.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c: { type: string; text: string }) => c.text);
    const content = textParts.join("");

    // Extract tool calls
    const toolCallParts = aMsg.content.filter(
      (
        c
      ): c is {
        type: "toolCall";
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      } => c.type === "toolCall"
    );
    const toolCalls =
      toolCallParts.length > 0 ? JSON.stringify(toolCallParts) : undefined;

    const usage = aMsg.usage ? JSON.stringify(aMsg.usage) : undefined;

    return {
      role: "assistant",
      content,
      ...(usage === undefined ? {} : { usage }),
      ...(toolCalls === undefined ? {} : { toolCalls }),
      ...(aMsg.stopReason ? { stopReason: aMsg.stopReason } : {}),
      ...(aMsg.errorMessage ? { errorMessage: aMsg.errorMessage } : {}),
    };
  }

  // role === "tool"
  const tMsg = msg as AgentMessage & { role: "tool" };
  return {
    role: "tool",
    content: tMsg.content
      .map((c: { type: string; text: string }) => c.text)
      .join(""),
    toolCallId: tMsg.toolCallId,
    toolName: tMsg.toolName,
    isError: tMsg.isError ? 1 : 0,
  };
}
