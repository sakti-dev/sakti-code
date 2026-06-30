import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vite-plus/test";
import { clearProfileCache } from "../agent/model-resolver.ts";
import { buildApp } from "../app.ts";
import {
  fauxAssistantMessage,
  teardownFauxLlm,
  useFauxLlm,
} from "./llm-helpers.ts";

const TEST_MODEL_ID = "gpt-4";

const { compactionRoutes } = await import("../routes/sessions/compaction.ts");
const { statsRoutes } = await import("../routes/sessions/stats.ts");
const { makeApp, makeContext, seedProfile } = await import("./helpers.ts");

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
  clearProfileCache();
});

describe("route composition", () => {
  it("compaction and stats routes work together via makeApp", async () => {
    useFauxLlm([fauxAssistantMessage("Compacted session summary.")]);
    const { app, ctx } = await makeApp([compactionRoutes, statsRoutes]);

    const project = await ctx.repos.projects.create("p", tempDir);
    seedProfile(ctx, { provider: "openai", model: TEST_MODEL_ID });
    ctx.auth.set("openai", "test-key-1234567890");
    const session = await ctx.repos.sessions.create(project.id);

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
    const { ctx } = await makeContext();
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
