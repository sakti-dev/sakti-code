import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDatabase } from "@sakti-code/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.ts";
import { createContext } from "../context.ts";
import { createApiKeyStore } from "../lib/api-key-store.ts";
import {
  fauxAssistantMessage,
  teardownFauxLlm,
  useFauxLlm,
} from "./llm-helpers.ts";

const TEST_MODEL_ID = "gpt-4";

const { compactionRoutes } = await import("../routes/sessions/compaction.ts");
const { statsRoutes } = await import("../routes/sessions/stats.ts");
const { makeApp } = await import("./helpers.ts");

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "sakti-composition-test-"));
});

afterAll(() => {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});

afterEach(() => {
  teardownFauxLlm();
});

describe("route composition", () => {
  it("compaction and stats routes work together via makeApp", async () => {
    useFauxLlm([fauxAssistantMessage("Compacted session summary.")]);
    const { app, ctx } = await makeApp([compactionRoutes, statsRoutes]);

    const project = await ctx.repos.projects.create("p", tempDir);
    ctx.repos.models.set({
      projectId: project.id,
      provider: "openai",
      modelId: TEST_MODEL_ID,
    });
    const session = await ctx.repos.sessions.create(project.id, TEST_MODEL_ID);

    const statsRes = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/stats`)
    );
    expect(statsRes.status).toBe(200);

    const compactRes = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/compact`, {
        method: "POST",
      })
    );
    expect(compactRes.status).toBe(200);
  });

  it("compaction and stats routes both return 404 for unknown sessions", async () => {
    const { app } = await makeApp([compactionRoutes, statsRoutes]);

    const statsRes = await app.request(
      new Request("http://localhost/api/sessions/nope/stats")
    );
    expect(statsRes.status).toBe(404);

    const compactRes = await app.request(
      new Request("http://localhost/api/sessions/nope/compact", {
        method: "POST",
      })
    );
    expect(compactRes.status).toBe(404);
  });

  it("default app serves feature routes in production", async () => {
    const db = await initDatabase(new Database(":memory:"));
    const ctx = createContext(
      db,
      {},
      createApiKeyStore(`/tmp/sakti-test-keys-${Date.now()}.json`)
    );
    const server = buildApp(ctx);

    const settingsRes = await server.request("http://localhost/api/settings");
    expect(settingsRes.status).toBe(200);

    const body = await (
      await server.request("http://localhost/api/settings")
    ).json();
    expect(typeof body).toBe("object");
    expect(body).not.toBeNull();
  });
});
