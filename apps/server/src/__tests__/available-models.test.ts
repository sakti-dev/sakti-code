import { describe, expect, it, type mock } from "bun:test";

// pi-ai is globally mocked via apps/server/test-setup.ts.
// Override getProviders and getModels with test-specific values.
const { getProviders, getModels } = await import("@earendil-works/pi-ai");
(getProviders as ReturnType<typeof mock>).mockImplementation(() => [
  "openai",
  "anthropic",
]);
(getModels as ReturnType<typeof mock>).mockImplementation((p: string) =>
  p === "openai"
    ? [{ id: "gpt-4o", name: "GPT-4o", provider: "openai" }]
    : [{ id: "claude-3", name: "Claude 3", provider: "anthropic" }]
);

const { availableModelsRoutes } = await import(
  "../routes/models/available-models.ts"
);

describe("available-models routes", () => {
  it("lists providers", async () => {
    const res = await availableModelsRoutes.handle(
      new Request("http://localhost:3001/api/available-models")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(["openai", "anthropic"]);
  });

  it("lists models for a provider", async () => {
    const res = await availableModelsRoutes.handle(
      new Request("http://localhost:3001/api/available-models/openai")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0]?.id).toBe("gpt-4o");
  });
});
