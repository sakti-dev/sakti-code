import { PROVIDER_INFO } from "@sakti-code/llm";
import { describe, expect, it } from "vite-plus/test";
import { makeApp } from "./helpers.ts";

const { connectedModelsRoutes } = await import("../routes/models/connected.ts");

describe("GET /api/models/connected", () => {
  it("returns 200 with shaped response for connected providers", async () => {
    const { app, ctx } = await makeApp([connectedModelsRoutes]);

    ctx.auth.set("openai", "sk-test-123");

    const res = await app.request(new Request("http://localhost:3001/api/models/connected"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);

    const openai = body.find((p: { providerId: string }) => p.providerId === "openai");
    expect(openai).toBeDefined();
    expect(PROVIDER_INFO.openai).toBeDefined();
    expect(openai.providerName).toBe(PROVIDER_INFO.openai!.name);

    expect(Array.isArray(openai.models)).toBe(true);
    expect(openai.models.length).toBeGreaterThan(0);

    for (const model of openai.models) {
      expect(model).toHaveProperty("id");
      expect(model).toHaveProperty("name");
      expect(model).toHaveProperty("reasoning");
      expect(typeof model.id).toBe("string");
      expect(typeof model.name).toBe("string");
      expect(typeof model.reasoning).toBe("boolean");
    }
  });

  it("sorts deprecated models to the bottom within each provider", async () => {
    const { app, ctx } = await makeApp([connectedModelsRoutes]);

    ctx.auth.set("anthropic", "sk-ant-test-456");

    const res = await app.request(new Request("http://localhost:3001/api/models/connected"));
    expect(res.status).toBe(200);

    const body = (await res.json()) as Array<{
      providerId: string;
      models: Array<{ id: string; status?: string }>;
    }>;
    const anthropic = body.find((p) => p.providerId === "anthropic");
    expect(anthropic).toBeDefined();

    const models = anthropic!.models;
    const deprecatedIdx = models.findIndex((m) => m.status === "deprecated");
    const nonDeprecatedIdx = models.findLastIndex((m) => m.status !== "deprecated");

    if (deprecatedIdx !== -1 && nonDeprecatedIdx !== -1) {
      expect(deprecatedIdx).toBeGreaterThan(nonDeprecatedIdx);
    }
  });

  it("excludes providers without a seeded key", async () => {
    const { app, ctx } = await makeApp([connectedModelsRoutes]);

    ctx.auth.set("openai", "sk-test-123");
    const res = await app.request(new Request("http://localhost:3001/api/models/connected"));
    expect(res.status).toBe(200);

    const body = (await res.json()) as Array<{
      providerId: string;
    }>;

    const anthropic = body.find((p) => p.providerId === "anthropic");
    expect(anthropic).toBeUndefined();
  });

  it("returns empty array when no providers have keys", async () => {
    const { app } = await makeApp([connectedModelsRoutes]);

    const res = await app.request(new Request("http://localhost:3001/api/models/connected"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it("only includes id, name, status, reasoning on each model", async () => {
    const { app, ctx } = await makeApp([connectedModelsRoutes]);

    ctx.auth.set("openai", "sk-test-123");

    const res = await app.request(new Request("http://localhost:3001/api/models/connected"));
    const body = (await res.json()) as Array<{
      providerId: string;
      models: Record<string, unknown>[];
    }>;
    const openai = body.find((p) => p.providerId === "openai");
    expect(openai).toBeDefined();

    for (const model of openai!.models) {
      const keys = Object.keys(model).sort();
      if (model.status === undefined) {
        expect(keys).toEqual(["id", "name", "reasoning"]);
      } else {
        expect(keys).toEqual(["id", "name", "reasoning", "status"]);
      }
    }
  });
});
