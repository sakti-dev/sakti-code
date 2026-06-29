import type { DrizzleDB } from "@sakti-code/db";
import { SqliteSessionStorage } from "@sakti-code/db";
import { Effect } from "effect";

export interface SeedMessage {
  content: string;
  role: "user" | "assistant" | "toolResult";
  toolCallId?: string;
  toolName?: string;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
  };
}

/**
 * Seed a session with message entries in the entry tree.
 * Returns the storage instance for further operations.
 */
export async function seedEntries(
  db: DrizzleDB,
  sessionId: string,
  messages: SeedMessage[]
): Promise<SqliteSessionStorage> {
  const storage = new SqliteSessionStorage(db, sessionId, {
    id: sessionId,
    createdAt: new Date().toISOString(),
  });
  let parentId: string | null = null;

  for (const msg of messages) {
    const id = crypto.randomUUID();
    const timestamp = Date.now();

    if (msg.role === "user") {
      await Effect.runPromise(
        storage.appendEntry({
          id,
          parentId,
          timestamp: new Date(timestamp).toISOString(),
          type: "message",
          message: { role: "user", content: msg.content, timestamp },
        })
      );
    } else if (msg.role === "assistant") {
      await Effect.runPromise(
        storage.appendEntry({
          id,
          parentId,
          timestamp: new Date(timestamp).toISOString(),
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "text", text: msg.content }],
            usage: msg.usage ?? {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
            stopReason: "stop",
            provider: "openai",
            model: "test-model",
            api: "responses",
            timestamp,
          },
        })
      );
    } else {
      await Effect.runPromise(
        storage.appendEntry({
          id,
          parentId,
          timestamp: new Date(timestamp).toISOString(),
          type: "message",
          message: {
            role: "toolResult",
            content: [{ type: "text", text: msg.content }],
            toolCallId: msg.toolCallId ?? "test-call",
            toolName: msg.toolName ?? "test-tool",
            isError: false,
            timestamp,
          },
        })
      );
    }
    parentId = id;
  }

  return storage;
}

/**
 * Create a SqliteSessionStorage for a session, useful in route tests.
 */
export function makeStorage(
  db: DrizzleDB,
  sessionId: string
): SqliteSessionStorage {
  return new SqliteSessionStorage(db, sessionId, {
    id: sessionId,
    createdAt: new Date().toISOString(),
  });
}
