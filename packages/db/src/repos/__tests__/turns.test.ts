import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { initDatabase } from "../../init.ts";
import { ProjectRepo, SessionRepo } from "../index.ts";
import { TurnRepo } from "../turns.ts";

describe("TurnRepo", () => {
  let tmpDir: string;
  let rawDb: DatabaseSync;
  let db: Awaited<ReturnType<typeof initDatabase>>;
  let projects: ProjectRepo;
  let sessions: SessionRepo;
  let turns: TurnRepo;
  let sessionId: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "test-XXXXXX"));
    rawDb = new DatabaseSync(join(tmpDir, "test.db"));
    db = await initDatabase(rawDb);
    projects = new ProjectRepo(db);
    sessions = new SessionRepo(db);
    turns = new TurnRepo(db);
    const project = await projects.create("p", "/tmp/test");
    const session = await sessions.create(project.id);
    sessionId = session.id;
  });

  afterAll(() => {
    rawDb.close?.();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("create inserts a turn with auto-incrementing sequence", () => {
    const turn = turns.create(sessionId, 1000);
    expect(turn.sequence).toBe(0);
    expect(turn.startedAt).toBe(1000);
    expect(turn.endedAt).toBeNull();

    const turn2 = turns.create(sessionId, 2000);
    expect(turn2.sequence).toBe(1);
  });

  it("finalize sets endedAt", () => {
    const turn = turns.create(sessionId, 3000);
    turns.finalize(turn.id, 5000);
    const list = turns.listBySession(sessionId);
    const found = list.find((t) => t.id === turn.id);
    expect(found?.endedAt).toBe(5000);
  });

  it("finalizeLatest only finalizes the last unfinalized turn", () => {
    turns.create(sessionId, 6000);
    turns.finalizeLatest(sessionId, 7000);
    const list = turns.listBySession(sessionId);
    const last = list.at(-1);
    expect(last?.endedAt).toBe(7000);
  });

  it("finalizeLatest is a no-op when last turn is already finalized", () => {
    const before = turns.listBySession(sessionId).at(-1);
    turns.finalizeLatest(sessionId, 99_999);
    const after = turns.listBySession(sessionId).at(-1);
    expect(after?.endedAt).toBe(before?.endedAt);
  });

  it("listBySession returns turns ordered by sequence", () => {
    const list = turns.listBySession(sessionId);
    expect(list.length).toBeGreaterThan(0);
    for (let i = 1; i < list.length; i++) {
      expect(list[i]!.sequence).toBeGreaterThan(list[i - 1]!.sequence);
    }
  });

  it("listBySession returns empty for unknown session", () => {
    expect(turns.listBySession("nonexistent")).toEqual([]);
  });

  it("copyForFork copies all turns to a new session", async () => {
    const project2 = await projects.create("p2", "/tmp/test2");
    const session2 = await sessions.create(project2.id);
    turns.copyForFork(sessionId, session2.id);
    const sourceTurns = turns.listBySession(sessionId);
    const forkedTurns = turns.listBySession(session2.id);
    expect(forkedTurns).toHaveLength(sourceTurns.length);
    expect(forkedTurns[0]!.sequence).toBe(sourceTurns[0]!.sequence);
    expect(forkedTurns[0]!.startedAt).toBe(sourceTurns[0]!.startedAt);
    expect(forkedTurns[0]!.id).not.toBe(sourceTurns[0]!.id);
  });

  it("markSummary sets isTurnSummary on the turn's last assistant entry", async () => {
    const project3 = await projects.create("p3", "/tmp/test3");
    const session3 = await sessions.create(project3.id);
    const turn = turns.create(session3.id, 1000);

    const seed = (id: string, role: string, seq: number): void => {
      rawDb
        .prepare(
          "INSERT INTO session_entries (id, session_id, parent_id, sequence, kind, content, timestamp, created_at, turn_id, is_turn_summary) VALUES (?, ?, NULL, ?, 'message', ?, '1', 1, ?, 0)",
        )
        .run(
          id,
          session3.id,
          seq,
          JSON.stringify({ type: "message", message: { role, content: "x" } }),
          turn.id,
        );
    };
    seed("u1", "user", 0);
    seed("a1", "assistant", 1);
    seed("a2", "assistant", 2);

    turns.markSummary(turn.id);

    const summaries = rawDb
      .prepare("SELECT id FROM session_entries WHERE is_turn_summary = 1")
      .all() as { id: string }[];
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.id).toBe("a2");
  });

  it("markSummary is a no-op when the turn has no assistant entry", () => {
    const turn = turns.create(sessionId, 9000);
    turns.markSummary(turn.id);
    const summaries = rawDb
      .prepare("SELECT id FROM session_entries WHERE is_turn_summary = 1 AND turn_id = ?")
      .all(turn.id);
    expect(summaries).toHaveLength(0);
  });

  it("getLatest returns the highest-sequence turn", () => {
    const latest = turns.getLatest(sessionId);
    const list = turns.listBySession(sessionId);
    expect(latest?.id).toBe(list.at(-1)?.id);
  });

  it("getLatest returns null for unknown session", () => {
    expect(turns.getLatest("nonexistent")).toBeNull();
  });
});
