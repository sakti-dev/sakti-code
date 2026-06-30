import { PROVIDER_INFO } from "@sakti-code/llm";
import { describe, expect, it } from "vite-plus/test";
import { makeApp } from "./helpers.ts";

const { availableModelsRoutes } = await import("../routes/models/available-models.ts");

describe("available-models routes", () => {
  it("lists providers with metadata and a connected flag", async () => {
    const { app } = await makeApp([availableModelsRoutes]);
    const res = await app.request(new Request("http://localhost:3001/api/models/available"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);

    const openai = body.find((p: { id: string }) => p.id === "openai");
    expect(openai).toBeDefined();
    expect(openai.name).toBe(PROVIDER_INFO.openai?.name);
    expect(typeof openai.modelCount).toBe("number");
    expect(openai.modelCount).toBeGreaterThan(0);
    expect(typeof openai.connected).toBe("boolean");
    expect(openai.connected).toBe(false);
  });

  it("marks a provider connected once its key is seeded", async () => {
    const { app, ctx } = await makeApp([availableModelsRoutes]);
    ctx.auth.set("openai", "sk-test-123");

    const res = await app.request(new Request("http://localhost:3001/api/models/available"));
    const body = await res.json();

    const openai = body.find((p: { id: string }) => p.id === "openai");
    expect(openai.connected).toBe(true);

    const anthropic = body.find((p: { id: string }) => p.id === "anthropic");
    expect(anthropic.connected).toBe(false);
  });

  it("only includes id, name, modelCount, connected on each provider", async () => {
    const { app } = await makeApp([availableModelsRoutes]);
    const res = await app.request(new Request("http://localhost:3001/api/models/available"));
    const body = (await res.json()) as Record<string, unknown>[];
    expect(body.length).toBeGreaterThan(0);
    for (const provider of body) {
      expect(Object.keys(provider).sort()).toEqual(["connected", "id", "modelCount", "name"]);
    }
  });
});
