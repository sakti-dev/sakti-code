import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStorage } from "@sakti-code/db";
import { Effect } from "effect";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { clearProfileCache } from "../agent/model-resolver.ts";
import {
  fauxAssistantMessage,
  teardownFauxLlm,
  useFauxLlm,
} from "./llm-helpers.ts";

const { compactionRoutes } = await import("../routes/sessions/compaction.ts");
const { makeApp, seedProfile } = await import("./helpers.ts");

const MODEL_ERROR_RE = /model|api key|provider/;

/** Real model id so `getModel("openai", id)` resolves during runPrompt/compact. */
const TEST_MODEL_ID = "gpt-4";

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "sakti-compaction-test-"));
});

afterEach(() => {
  teardownFauxLlm();
  clearProfileCache();
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
    await Effect.runPromise(
      storage.appendEntry({
        id,
        parentId,
        timestamp: new Date().toISOString(),
        type: "message",
        message: {
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Message ${i}: ${"x".repeat(500)}`,
          timestamp: Date.now(),
        } as never,
      })
    );
    parentId = id;
  }
}

describe("compaction route", () => {
  it(
    "POST /api/sessions/:id/compact summarizes and persists",
    async () => {
      // Smoke-test mode: set SAKTI_SMOKE=1 + OPENCODE_API_KEY=<key> to run
      // against the real DeepSeek V4 Flash model via the opencode gateway.
      const isSmoke = process.env.SAKTI_SMOKE === "1";
      const smokeProvider = "opencode";
      const smokeModel = "deepseek-v4-flash-free";
      const smokeKey = process.env.OPENCODE_API_KEY;

      if (!isSmoke) {
        useFauxLlm([fauxAssistantMessage("Compacted summary of the session.")]);
      } else if (!smokeKey) {
        throw new Error(
          "SAKTI_SMOKE=1 but OPENCODE_API_KEY is not set — cannot run smoke test"
        );
      }

      const { app, ctx } = await makeApp([compactionRoutes]);
      const project = await ctx.repos.projects.create("p", tempDir);
      seedProfile(ctx, {
        provider: isSmoke ? smokeProvider : "openai",
        model: isSmoke ? smokeModel : TEST_MODEL_ID,
      });
      ctx.auth.set(
        isSmoke ? smokeProvider : "openai",
        isSmoke ? smokeKey! : "test-key-1234567890"
      );
      const session = await ctx.repos.sessions.create(project.id);

      await seedEntries(ctx.db, session.id, 200);

      const res = await app.request(
        new Request(`http://localhost/api/sessions/${session.id}/compact`, {
          method: "POST",
        })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tokensBefore).toBeGreaterThan(0);
      expect(typeof body.summary).toBe("string");
      expect(body.summary.length).toBeGreaterThan(0);
    },
    // Smoke mode hits a real LLM summarizing 200 messages — give it 2 minutes.
    process.env.SAKTI_SMOKE === "1" ? 120_000 : 15_000
  );

  it("POST /api/sessions/nope/compact returns 404", async () => {
    const { app } = await makeApp([compactionRoutes]);
    const res = await app.request(
      new Request("http://localhost/api/sessions/nope/compact", {
        method: "POST",
      })
    );
    expect(res.status).toBe(404);
  });

  it("returns 500 when no model configured (empty default profile)", async () => {
    const { app, ctx } = await makeApp([compactionRoutes]);
    const project = await ctx.repos.projects.create("p2", tempDir);
    const session = await ctx.repos.sessions.create(project.id);

    const res = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/compact`, {
        method: "POST",
      })
    );
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body.toLowerCase()).toMatch(MODEL_ERROR_RE);
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
    seedProfile(ctx, { provider: "openai", model: TEST_MODEL_ID });
    ctx.auth.set("openai", "test-key-1234567890");
    const session = await ctx.repos.sessions.create(project.id);
    await seedEntries(ctx.db, session.id, 200);

    const res = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/compact`, {
        method: "POST",
      })
    );
    expect(res.status).toBe(500);
  });

  it("returns 500 when no API key configured", async () => {
    // Don't seed ctx.auth — leave auth.json empty so ctx.auth.getApiKey returns undefined.
    delete process.env.OPENAI_API_KEY;

    const { app, ctx } = await makeApp([compactionRoutes]);
    const project = await ctx.repos.projects.create("p4", tempDir);
    seedProfile(ctx, { provider: "openai", model: TEST_MODEL_ID });
    const session = await ctx.repos.sessions.create(project.id);
    await seedEntries(ctx.db, session.id, 50);

    const res = await app.request(
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
    const res = await built.app.request(
      new Request("http://localhost/api/sessions/nope/compact", {
        method: "POST",
      })
    );
    expect(res.status).toBe(404);
  });
});
