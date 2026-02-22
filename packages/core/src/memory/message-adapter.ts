/**
 * MessageAdapter - Data translation between frontend and memory formats
 *
 * Converts between:
 * - Frontend: Chat Message (info + parts)
 * - Memory: CreateMessageInput (threadId, createdAt, rawContent)
 */

import type { Message, MessageInfo, Part } from "../chat";
import type { Message as DBMessage } from "../server-bridge";
import type { CreateMessageInput } from "./message/storage";

export class MessageAdapter {
  static toMemoryFormat(
    message: Message,
    threadId: string,
    resourceId: string,
    messageIndex: number
  ): CreateMessageInput {
    const content = this.extractContentFromParts(message.parts || []);
    const createdAt = typeof message.createdAt === "number" ? message.createdAt : Date.now();
    const role = message.info.role;

    if (role !== "user" && role !== "assistant" && role !== "system") {
      throw new Error(`Unsupported message role for memory adapter: ${String(role)}`);
    }

    return {
      id: message.info.id,
      threadId,
      resourceId,
      role,
      rawContent: content,
      searchText: content,
      injectionText: content,
      createdAt,
      messageIndex,
    };
  }

  static toFrontendFormat(dbMessage: DBMessage): MessageInfo {
    const created = dbMessage.created_at.getTime();

    if (dbMessage.role === "assistant") {
      return {
        role: "assistant",
        id: dbMessage.id,
        sessionID: dbMessage.thread_id,
        time: { created },
      };
    }

    if (dbMessage.role === "system") {
      return {
        role: "system",
        id: dbMessage.id,
      };
    }

    if (dbMessage.role !== "user") {
      throw new Error(`Unsupported DB message role for frontend adapter: ${dbMessage.role}`);
    }

    return {
      role: "user",
      id: dbMessage.id,
      sessionID: dbMessage.thread_id,
      time: { created },
    };
  }

  private static extractContentFromParts(parts: Part[]): string {
    const textParts = parts.filter(p => p.type === "text" && "text" in p);
    return textParts.map(p => ("text" in p ? p.text : "")).join("\n");
  }
}
