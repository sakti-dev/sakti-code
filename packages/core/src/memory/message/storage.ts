/**
 * MessageStorage - Message storage with FTS5 integration
 *
 * Phase 1 Memory System - Message storage with three-storage model for non-destructive compaction.
 */

import { and, eq, sql } from "drizzle-orm";
import { getDb, messages, threads, type Message } from "../../server-bridge";

export interface CreateMessageInput {
  id: string;
  threadId: string;
  resourceId?: string;
  role: "user" | "assistant" | "system" | "tool";
  rawContent: string;
  searchText?: string;
  injectionText?: string;
  taskId?: string;
  sessionId?: string;
  createdAt: number;
  messageIndex: number;
}

export interface ListMessagesOptions {
  threadId?: string;
  resourceId?: string;
  limit?: number;
}

export class MessageStorage {
  async createMessage(input: CreateMessageInput): Promise<Message> {
    const db = await getDb();
    const searchText = input.searchText ?? input.rawContent;
    const injectionText = input.injectionText ?? input.rawContent;

    let taskIdToUse = input.taskId ?? null;

    if (!taskIdToUse) {
      const thread = await db.select().from(threads).where(eq(threads.id, input.threadId)).get();

      const activeTaskId = thread?.metadata?.activeTaskId as string | undefined;
      if (activeTaskId) {
        if (!input.sessionId) {
          taskIdToUse = activeTaskId;
        } else {
          const { taskStorage } = await import("../task/storage");
          const task = await taskStorage.getTask(activeTaskId);
          if (task && task.session_id === input.sessionId) {
            taskIdToUse = activeTaskId;
          }
        }
      }
    }

    const [message] = await db
      .insert(messages)
      .values({
        id: input.id,
        thread_id: input.threadId,
        resource_id: input.resourceId ?? null,
        role: input.role,
        raw_content: input.rawContent,
        search_text: searchText,
        injection_text: injectionText,
        task_id: taskIdToUse,
        created_at: new Date(input.createdAt),
        message_index: input.messageIndex,
      })
      .returning();

    return message;
  }

  async getMessage(id: string): Promise<Message | null> {
    const db = await getDb();
    const result = await db.select().from(messages).where(eq(messages.id, id)).get();
    return result ?? null;
  }

  async listMessages(options?: ListMessagesOptions): Promise<Message[]> {
    const db = await getDb();

    if (options?.threadId && options?.resourceId) {
      return db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.thread_id, options.threadId!),
            eq(messages.resource_id, options.resourceId!)
          )
        )
        .orderBy(messages.message_index)
        .limit(options.limit ?? 100)
        .all();
    }

    if (options?.threadId) {
      return db
        .select()
        .from(messages)
        .where(eq(messages.thread_id, options.threadId!))
        .orderBy(messages.message_index)
        .limit(options.limit ?? 100)
        .all();
    }

    if (options?.resourceId) {
      return db
        .select()
        .from(messages)
        .where(eq(messages.resource_id, options.resourceId!))
        .orderBy(messages.message_index)
        .limit(options.limit ?? 100)
        .all();
    }

    return db
      .select()
      .from(messages)
      .orderBy(messages.message_index)
      .limit(options?.limit ?? 100)
      .all();
  }

  async getMessageCount(threadId: string): Promise<number> {
    const db = await getDb();
    const result = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(messages)
      .where(eq(messages.thread_id, threadId));
    return result[0]?.count ?? 0;
  }

  async deleteMessage(id: string): Promise<void> {
    const db = await getDb();
    await db.delete(messages).where(eq(messages.id, id));
  }

  async searchMessages(searchQuery: string, limit: number = 5): Promise<Message[]> {
    const db = await getDb();

    // Use BM25 + recency boost for ranking
    // Smaller BM25 = better match (ascending sort)
    // Newer messages (higher created_at) get a slight boost
    const RECENCY_FACTOR = 0.0000001;

    const results = await db.all(sql`
      SELECT 
        m.id,
        m.thread_id,
        m.resource_id,
        m.role,
        m.raw_content,
        m.search_text,
        m.injection_text,
        m.task_id,
        m.summary,
        m.compaction_level,
        m.created_at,
        m.message_index,
        m.token_count,
        bm25(messages_fts) as match_score,
        (bm25(messages_fts) - (m.created_at * ${RECENCY_FACTOR})) as final_rank
      FROM messages_fts fts
      JOIN messages m ON m.rowid = fts.rowid
      WHERE messages_fts MATCH ${searchQuery}
      ORDER BY final_rank ASC
      LIMIT ${limit}
    `);

    return results as Message[];
  }

  async searchMessagesWithRecency(
    searchQuery: string,
    limit: number = 5,
    threadId?: string
  ): Promise<Array<Message & { matchScore: number; finalRank: number }>> {
    const db = await getDb();
    const RECENCY_FACTOR = 0.0000001;

    let query;
    if (threadId) {
      query = sql`
        SELECT 
          m.id,
          m.thread_id,
          m.resource_id,
          m.role,
          m.raw_content,
          m.search_text,
          m.injection_text,
          m.task_id,
          m.summary,
          m.compaction_level,
          m.created_at,
          m.message_index,
          m.token_count,
          bm25(messages_fts) as match_score,
          (bm25(messages_fts) - (m.created_at * ${RECENCY_FACTOR})) as final_rank
        FROM messages_fts fts
        JOIN messages m ON m.rowid = fts.rowid
        WHERE messages_fts MATCH ${searchQuery} AND m.thread_id = ${threadId}
        ORDER BY final_rank ASC
        LIMIT ${limit}
      `;
    } else {
      query = sql`
        SELECT 
          m.id,
          m.thread_id,
          m.resource_id,
          m.role,
          m.raw_content,
          m.search_text,
          m.injection_text,
          m.task_id,
          m.summary,
          m.compaction_level,
          m.created_at,
          m.message_index,
          m.token_count,
          bm25(messages_fts) as match_score,
          (bm25(messages_fts) - (m.created_at * ${RECENCY_FACTOR})) as final_rank
        FROM messages_fts fts
        JOIN messages m ON m.rowid = fts.rowid
        WHERE messages_fts MATCH ${searchQuery}
        ORDER BY final_rank ASC
        LIMIT ${limit}
      `;
    }

    const results = await db.all(query);

    return (results as Record<string, unknown>[]).map(row => ({
      // LibSQL can return timestamps as Date or number depending on query path.
      // Normalize to Date so downstream serializers are stable.
      created_at:
        row.created_at instanceof Date
          ? row.created_at
          : new Date(
              typeof row.created_at === "number"
                ? row.created_at
                : Number(row.created_at ?? Date.now())
            ),
      id: row.id as string,
      thread_id: row.thread_id as string,
      resource_id: row.resource_id as string | null,
      role: row.role as string,
      raw_content: row.raw_content as string,
      search_text: row.search_text as string,
      injection_text: row.injection_text as string,
      task_id: row.task_id as string | null,
      summary: row.summary as string | null,
      compaction_level: row.compaction_level as number,
      message_index: row.message_index as number,
      token_count: row.token_count as number | null,
      matchScore: row.match_score as number,
      finalRank: row.final_rank as number,
    }));
  }
}

export const messageStorage = new MessageStorage();
