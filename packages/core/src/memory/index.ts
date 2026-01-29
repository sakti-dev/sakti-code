/**
 * Memory integration for ekacode
 *
 * Provides semantic recall and working memory using Mastra Memory with libsql backend.
 */

import { resolveAppPaths } from "@ekacode/shared/paths";
import type { MastraDBMessage } from "@mastra/core/agent";
import { fastembed } from "@mastra/fastembed";
import { LibSQLStore, LibSQLVector } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import type { UIDataTypes, UIMessagePart, UITools } from "ai";
import { v7 as uuidv7 } from "uuid";

/**
 * Ekacode memory wrapper
 *
 * Integrates Mastra Memory for semantic search and working memory.
 */
export class EkacodeMemory {
  private memory: Memory;
  private threadConfig = {
    lastMessages: 10,
    semanticRecall: { topK: 4, messageRange: 2, scope: "thread" as const },
  };

  constructor() {
    const paths = resolveAppPaths();
    const authToken = process.env.EKACODE_MASTRA_DB_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN;

    const storage = new LibSQLStore({
      id: "ekacode-store",
      url: paths.mastraDbUrl,
      authToken,
    });

    this.memory = new Memory({
      storage,
      vector: new LibSQLVector({ id: "ekacode-vector", url: paths.mastraDbUrl, authToken }),
      embedder: fastembed,
      options: this.threadConfig,
    });
  }

  /**
   * Recall semantic memory before model invocation
   *
   * Searches for relevant past context based on the query.
   *
   * @param query - The search query
   * @param threadId - The thread/conversation ID
   * @returns Relevant messages
   */
  async recall(
    query: string,
    threadId: string,
    resourceId: string
  ): Promise<Array<{ role: string; content: string }>> {
    const { messages } = await this.memory.recall({
      threadId,
      resourceId,
      threadConfig: this.threadConfig,
      vectorSearchString: query,
    });

    return messages.map(m => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    }));
  }

  /**
   * Save messages after each turn
   *
   * Stores messages in memory for future retrieval.
   *
   * @param threadId - The thread/conversation ID
   * @param _messages - Messages to save (not yet implemented)
   */
  async save(
    threadId: string,
    resourceId: string,
    messages: Array<{
      id?: string;
      role: "user" | "assistant" | "system";
      content: string;
      createdAt?: Date;
      parts?: Array<UIMessagePart<UIDataTypes, UITools>>;
    }>
  ): Promise<void> {
    let thread = await this.memory.getThreadById({ threadId });
    const now = new Date();

    if (!thread) {
      thread = await this.memory.saveThread({
        thread: {
          id: threadId,
          resourceId,
          title: `Session ${threadId}`,
          metadata: {},
          createdAt: now,
          updatedAt: now,
        },
      });
    } else if (thread.resourceId && thread.resourceId !== resourceId) {
      throw new Error(
        `Memory thread ${threadId} is owned by ${thread.resourceId} but ${resourceId} was provided.`
      );
    }

    const toMastraMessage = (message: {
      id?: string;
      role: "user" | "assistant" | "system";
      content: string;
      createdAt?: Date;
      parts?: Array<UIMessagePart<UIDataTypes, UITools>>;
    }): MastraDBMessage => {
      return {
        id: message.id ?? uuidv7(),
        role: message.role,
        createdAt: message.createdAt ?? new Date(),
        threadId,
        resourceId,
        content: {
          format: 2,
          parts: message.parts ?? [{ type: "text", text: message.content }],
        },
      };
    };

    await this.memory.saveMessages({
      messages: messages.map(toMastraMessage),
      memoryConfig: this.threadConfig,
    });
  }

  /**
   * Get the underlying Mastra Memory instance
   */
  getMemory(): Memory {
    return this.memory;
  }
}

/**
 * Singleton memory instance
 */
let memoryInstance: EkacodeMemory | null = null;

export function getMemory(): EkacodeMemory {
  if (!memoryInstance) {
    memoryInstance = new EkacodeMemory();
  }
  return memoryInstance;
}
