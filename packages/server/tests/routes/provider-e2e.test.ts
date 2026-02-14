import { beforeEach, describe, expect, it } from "vitest";

describe("provider e2e flow", () => {
  beforeEach(async () => {
    const { setupTestDatabase } = await import("../../db/test-setup");
    await setupTestDatabase();
    const { db, sessions } = await import("../../db");
    await db.delete(sessions);

    delete process.env.ZAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  it("supports providers -> auth -> models flow", async () => {
    const providerRouter = (await import("../../src/routes/provider")).default;

    const providersRes = await providerRouter.request("http://localhost/api/providers");
    const providersBody = await providersRes.json();
    expect(providersRes.status).toBe(200);
    expect(Array.isArray(providersBody.providers)).toBe(true);

    const setTokenRes = await providerRouter.request(
      "http://localhost/api/providers/zai/auth/token",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "test-token" }),
      }
    );
    expect(setTokenRes.status).toBe(200);

    const authRes = await providerRouter.request("http://localhost/api/providers/auth");
    const authBody = await authRes.json();
    expect(authRes.status).toBe(200);
    expect(authBody.zai.status).toBe("connected");

    const modelsRes = await providerRouter.request("http://localhost/api/providers/models");
    const modelsBody = await modelsRes.json();
    expect(modelsRes.status).toBe(200);
    expect(modelsBody.models.length).toBeGreaterThan(0);
  });
});
