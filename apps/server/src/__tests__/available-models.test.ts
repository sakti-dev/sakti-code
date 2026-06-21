import { describe, expect, it } from "bun:test";
import { getModels, getProviders } from "@earendil-works/pi-ai";

const { availableModelsRoutes } = await import(
  "../routes/models/available-models.ts"
);

describe("available-models routes", () => {
  it("lists providers", async () => {
    const res = await availableModelsRoutes.handle(
      new Request("http://localhost:3001/models/available")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(getProviders());
    expect(Array.isArray(body)).toBe(true);
    expect(body).toContain("openai");
  });

  it("lists models for a provider", async () => {
    const res = await availableModelsRoutes.handle(
      new Request("http://localhost:3001/models/available/openai")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(getModels("openai"));
    expect(body.length).toBeGreaterThan(0);
    expect(
      body.every((m: { provider: string }) => m.provider === "openai")
    ).toBe(true);
  });
});
