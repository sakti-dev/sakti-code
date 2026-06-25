import { PROVIDER_INFO } from "@sakti-code/llm";
import { describe, expect, it } from "vitest";

const { availableModelsRoutes } = await import(
  "../routes/models/available-models.ts"
);

describe("available-models routes", () => {
  it("lists providers with metadata", async () => {
    const res = await availableModelsRoutes.request(
      new Request("http://localhost:3001/models/available")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);

    const openai = body.find((p: { id: string }) => p.id === "openai");
    expect(openai).toBeDefined();
    expect(openai.name).toBe(PROVIDER_INFO.openai?.name);
    expect(typeof openai.modelCount).toBe("number");
    expect(openai.modelCount).toBeGreaterThan(0);

    expect(body.every((p: object) => typeof p === "object")).toBe(true);
  });
});
