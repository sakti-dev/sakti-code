import { SessionManager } from "@sakti-code/core";
import { desc, eq } from "drizzle-orm";
import { db, taskSessions } from "../db";
import { getServerToken } from "./server-token";

const sessionDbAdapter = {
  insert: (table: string) => ({
    values: async (values: Record<string, unknown>) => {
      if (table === "sessions") {
        await db.insert(taskSessions).values(values as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      }
    },
  }),
  query: {
    sessions: {
      findMany: async (_opts?: {
        orderBy?: (taskSessions: unknown, { desc }: { desc: (col: unknown) => unknown }) => unknown[];
      }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const results = await (db as any)
          .select()
          .from(taskSessions)
          .orderBy(desc(taskSessions.last_accessed))
          .all();
        return results;
      },
      findFirst: async (opts: { where: { session_id: string } }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (db as any)
          .select()
          .from(taskSessions)
          .where(eq(taskSessions.session_id, opts.where.session_id))
          .limit(1)
          .get();
        return result || undefined;
      },
    },
  },
};

let globalSessionManager: SessionManager | null = null;

export function getSessionManager(): SessionManager {
  if (!globalSessionManager) {
    globalSessionManager = new SessionManager(
      sessionDbAdapter as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      "./checkpoints"
    );
  }
  return globalSessionManager;
}

export { getServerToken };
