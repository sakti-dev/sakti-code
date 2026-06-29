import { DatabaseSync } from "node:sqlite";
import type { AgentMessage } from "@sakti-code/agent";
import {
  initDatabase,
  ProjectRepo,
  SessionRepo,
  SqliteSessionStorage,
} from "@sakti-code/db";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

async function seedConversation(
  storage: SqliteSessionStorage,
  messages: Array<{ role: string; content: string }>
): Promise<string[]> {
  let parentId: string | null = null;
  const ids: string[] = [];
  for (const msg of messages) {
    const id = crypto.randomUUID();
    ids.push(id);
    await Effect.runPromise(
      storage.appendEntry({
        id,
        parentId,
        timestamp: new Date().toISOString(),
        type: "message",
        message: {
          role: msg.role,
          content: msg.content,
          timestamp: Date.now(),
        } as unknown as AgentMessage,
      })
    );
    parentId = id;
  }
  return ids;
}

describe("SqliteSessionStorage.forkFrom", () => {
  it("forks all entries to a new session", async () => {
    const db = await initDatabase(new DatabaseSync(":memory:"));
    const projectRepo = new ProjectRepo(db);
    const sessionRepo = new SessionRepo(db);

    const project = await projectRepo.create("test", "/tmp");
    const sourceSession = await sessionRepo.create(project.id);

    const sourceStorage = new SqliteSessionStorage(db, sourceSession.id, {
      id: sourceSession.id,
      createdAt: new Date().toISOString(),
    });
    await seedConversation(sourceStorage, [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
      { role: "user", content: "How are you?" },
    ]);

    const forkedSession = await sessionRepo.create(project.id, {
      parentSessionId: sourceSession.id,
    });
    const forkedStorage = new SqliteSessionStorage(db, forkedSession.id, {
      id: forkedSession.id,
      createdAt: new Date().toISOString(),
    });

    await Effect.runPromise(forkedStorage.forkFrom(sourceSession.id));

    const sourceEntries = await Effect.runPromise(sourceStorage.getEntries());
    const forkedEntries = await Effect.runPromise(forkedStorage.getEntries());

    expect(forkedEntries).toHaveLength(sourceEntries.length);
    expect(forkedEntries[0]?.type).toBe(sourceEntries[0]?.type);

    // Verify the tree structure is preserved
    const forkedLeaf = await Effect.runPromise(forkedStorage.getLeafId());
    expect(forkedLeaf).not.toBeNull();
    const forkedPath = await Effect.runPromise(
      forkedStorage.getPathToRoot(forkedLeaf)
    );
    expect(forkedPath.length).toBe(sourceEntries.length);

    // Verify the IDs were regenerated (not pointing at the source session's entries)
    for (const entry of forkedEntries) {
      expect(entry.id).not.toBe(sourceEntries[0]?.id);
    }
  });

  it("forks partial entries up to a specific entry id", async () => {
    const db = await initDatabase(new DatabaseSync(":memory:"));
    const projectRepo = new ProjectRepo(db);
    const sessionRepo = new SessionRepo(db);

    const project = await projectRepo.create("test2", "/tmp2");
    const sourceSession = await sessionRepo.create(project.id);

    const sourceStorage = new SqliteSessionStorage(db, sourceSession.id, {
      id: sourceSession.id,
      createdAt: new Date().toISOString(),
    });

    // Seed 3 messages; capture the IDs
    const entryIds = await seedConversation(sourceStorage, [
      { role: "user", content: "A" },
      { role: "assistant", content: "B" },
      { role: "user", content: "C" },
    ]);

    const forkedSession = await sessionRepo.create(project.id);
    const forkedStorage = new SqliteSessionStorage(db, forkedSession.id, {
      id: forkedSession.id,
      createdAt: new Date().toISOString(),
    });

    // Fork up to entryIds[1] (include first 2 entries)
    await Effect.runPromise(
      forkedStorage.forkFrom(sourceSession.id, entryIds[1])
    );

    const forkedEntries = await Effect.runPromise(forkedStorage.getEntries());
    expect(forkedEntries).toHaveLength(2);

    // Leaf should be the last copied entry (entryIds[1] equivalent)
    const forkedLeaf = await Effect.runPromise(forkedStorage.getLeafId());
    expect(forkedLeaf).not.toBeNull();
    const forkedPath = await Effect.runPromise(
      forkedStorage.getPathToRoot(forkedLeaf)
    );
    expect(forkedPath).toHaveLength(2);
  });

  it("forking a session with no entries yields an empty fork", async () => {
    const db = await initDatabase(new DatabaseSync(":memory:"));
    const projectRepo = new ProjectRepo(db);
    const sessionRepo = new SessionRepo(db);

    const project = await projectRepo.create("empty", "/tmp/empty");
    const sourceSession = await sessionRepo.create(project.id);
    const forkedSession = await sessionRepo.create(project.id);

    const forkedStorage = new SqliteSessionStorage(db, forkedSession.id, {
      id: forkedSession.id,
      createdAt: new Date().toISOString(),
    });

    await Effect.runPromise(forkedStorage.forkFrom(sourceSession.id));

    const forkedEntries = await Effect.runPromise(forkedStorage.getEntries());
    expect(forkedEntries).toEqual([]);
  });
});
