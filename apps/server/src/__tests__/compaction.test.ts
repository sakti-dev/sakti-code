import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStorage } from "@sakti-code/db";
import {
  fauxAssistantMessage,
  teardownFauxLlm,
  useFauxLlm,
} from "./llm-helpers.ts";

const { compactionRoutes } = await import("../routes/sessions/compaction.ts");
const { makeApp } = await import("./helpers.ts");

/** Real model id so `getModel("openai", id)` resolves during runPrompt/compact. */
const TEST_MODEL_ID = "gpt-4";

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "sakti-compaction-test-"));
});

afterEach(() => {
  teardownFauxLlm();
});

async function seedEntries(
  db: unknown,
  sessionId: string,
  count: number
): Promise<void> {
  const storage = new SqliteSessionStorage(db as never, sessionId, {
    id: sessionId,
    createdAt: new Date().toISOString(),
  });
  let parentId: string | null = null;
  for (let i = 0; i < count; i++) {
    const id = crypto.randomUUID();
    await storage.appendEntry({
      id,
      parentId,
      timestamp: new Date().toISOString(),
      type: "message",
      message: {
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message ${i}: ${"x".repeat(500)}`,
        timestamp: Date.now(),
      } as never,
    });
    parentId = id;
  }
}

describe("compaction route", () => {
  it("POST /api/sessions/:id/compact summarizes and persists", async () => {
    useFauxLlm([fauxAssistantMessage("Compacted summary of the session.")]);
    const { app, ctx } = await makeApp([compactionRoutes]);
    const project = await ctx.repos.projects.create("p", tempDir);
    ctx.repos.models.set({
      projectId: project.id,
      provider: "openai",
      modelId: TEST_MODEL_ID,
    });
    const session = await ctx.repos.sessions.create(project.id, TEST_MODEL_ID);

    await seedEntries(ctx.db, session.id, 200);

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/compact`, {
        method: "POST",
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tokensBefore).toBeGreaterThan(0);
    expect(typeof body.summary).toBe("string");
    expect(body.summary.length).toBeGreaterThan(0);
  });

  it("POST /api/sessions/nope/compact returns 404", async () => {
    const { app } = await makeApp([compactionRoutes]);
    const res = await app.handle(
      new Request("http://localhost/api/sessions/nope/compact", {
        method: "POST",
      })
    );
    expect(res.status).toBe(404);
  });

  it("returns 500 when no model configured", async () => {
    const { app, ctx } = await makeApp([compactionRoutes]);
    const project = await ctx.repos.projects.create("p2", tempDir);
    const session = await ctx.repos.sessions.create(project.id, TEST_MODEL_ID);

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/compact`, {
        method: "POST",
      })
    );
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toContain("model");
  });

  it("returns 500 on summarization error", async () => {
    useFauxLlm([
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "summarization failed",
      }),
    ]);

    const { app, ctx } = await makeApp([compactionRoutes]);
    const project = await ctx.repos.projects.create("p3", tempDir);
    ctx.repos.models.set({
      projectId: project.id,
      provider: "openai",
      modelId: TEST_MODEL_ID,
    });
    const session = await ctx.repos.sessions.create(project.id, TEST_MODEL_ID);
    await seedEntries(ctx.db, session.id, 200);

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/compact`, {
        method: "POST",
      })
    );
    expect(res.status).toBe(500);
  });

  it("returns 500 when no API key configured", async () => {
    // Don't call useFauxLlm — leave OPENAI_API_KEY unset so getEnvApiKey returns undefined.
    delete process.env.OPENAI_API_KEY;

    const { app, ctx } = await makeApp([compactionRoutes]);
    const project = await ctx.repos.projects.create("p4", tempDir);
    ctx.repos.models.set({
      projectId: project.id,
      provider: "openai",
      modelId: TEST_MODEL_ID,
    });
    const session = await ctx.repos.sessions.create(project.id, TEST_MODEL_ID);
    await seedEntries(ctx.db, session.id, 50);

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/compact`, {
        method: "POST",
      })
    );
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body.toLowerCase()).toContain("api key");
  });

  it("compactionRoutes is composable via makeApp", async () => {
    const built = await makeApp([compactionRoutes]);
    const res = await built.app.handle(
      new Request("http://localhost/api/sessions/nope/compact", {
        method: "POST",
      })
    );
    expect(res.status).toBe(404);
  });
});
