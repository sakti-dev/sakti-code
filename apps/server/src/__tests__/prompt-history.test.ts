import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { sessionEntries } from "@sakti-code/db";
import { promptHistoryRoutes } from "../routes/projects/prompt-history.ts";
import { makeApp } from "./helpers.ts";

describe("prompt history routes", () => {
  let app: Awaited<ReturnType<typeof makeApp>>["app"];
  let ctx: Awaited<ReturnType<typeof makeApp>>["ctx"];
  let projectA: string;

  beforeAll(async () => {
    const built = await makeApp([promptHistoryRoutes]);
    app = built.app;
    ctx = built.ctx;
    projectA = (await ctx.repos.projects.create("A", "/tmp/a")).id;
    const sA = (await ctx.repos.sessions.create(projectA)).id;
    let seq = 0;
    const mk = (id: string, text: string, createdAt: number) => ({
      id,
      sessionId: sA,
      parentId: null,
      sequence: seq++,
      kind: "message",
      timestamp: new Date(createdAt).toISOString(),
      createdAt,
      turnId: null,
      isTurnSummary: false,
      content: JSON.stringify({
        id,
        parentId: null,
        timestamp: new Date(createdAt).toISOString(),
        type: "message",
        message: { role: "user", content: text, timestamp: createdAt },
      }),
    });
    ctx.db
      .insert(sessionEntries)
      .values(mk("a1", "alpha", 1000))
      .run();
    ctx.db
      .insert(sessionEntries)
      .values(mk("a2", "beta", 2000))
      .run();
  });

  afterAll(() => {});

  it("GET /api/projects/:id/prompt-history returns deduped newest-first prompts", async () => {
    const res = await app.request(
      new Request(`http://localhost/api/projects/${projectA}/prompt-history`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prompts).toEqual(["beta", "alpha"]);
  });

  it("respects ?limit", async () => {
    const res = await app.request(
      new Request(`http://localhost/api/projects/${projectA}/prompt-history?limit=1`),
    );
    expect((await res.json()).prompts).toEqual(["beta"]);
  });

  it("unknown project returns 404", async () => {
    const res = await app.request(new Request("http://localhost/api/projects/nope/prompt-history"));
    expect(res.status).toBe(404);
  });
});
