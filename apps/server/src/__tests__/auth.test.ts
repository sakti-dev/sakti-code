import { describe, expect, it } from "vite-plus/test";
import { authRoutes } from "../routes/auth.ts";
import { makeApp } from "./helpers.ts";

describe("auth routes", () => {
  it("GET returns masked list", async () => {
    const { app } = await makeApp([authRoutes]);
    const res = await app.request(new Request("http://localhost/api/auth"));
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{
      provider: string;
      hasKey: boolean;
      maskedKey: string | null;
    }>;
    expect(list.length).toBeGreaterThan(0);
    for (const entry of list) {
      expect(entry.hasKey).toBe(false);
      expect(entry.maskedKey).toBeNull();
    }
  });

  it("POST sets a key, GET shows masked", async () => {
    const { app } = await makeApp([authRoutes]);
    const post = await app.request(
      new Request("http://localhost/api/auth/openai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: "sk-test-1234567890abcdef" }),
      })
    );
    expect(post.status).toBe(204);

    const res = await app.request(new Request("http://localhost/api/auth"));
    const list = (await res.json()) as Array<{
      provider: string;
      hasKey: boolean;
      maskedKey: string | null;
    }>;
    const openai = list.find((e) => e.provider === "openai");
    expect(openai?.hasKey).toBe(true);
    expect(openai?.maskedKey).toBe("...cdef");
  });

  it("DELETE removes a key", async () => {
    const { app } = await makeApp([authRoutes]);
    await app.request(
      new Request("http://localhost/api/auth/openai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: "sk-test-1234567890abcdef" }),
      })
    );

    const del = await app.request(
      new Request("http://localhost/api/auth/openai", {
        method: "DELETE",
      })
    );
    expect(del.status).toBe(204);

    const res = await app.request(new Request("http://localhost/api/auth"));
    const list = (await res.json()) as Array<{
      provider: string;
      hasKey: boolean;
    }>;
    const openai = list.find((e) => e.provider === "openai");
    expect(openai?.hasKey).toBe(false);
  });

  it("POST unknown provider returns 400", async () => {
    const { app } = await makeApp([authRoutes]);
    const res = await app.request(
      new Request("http://localhost/api/auth/bogus", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: "x" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("POST empty key returns 400", async () => {
    const { app } = await makeApp([authRoutes]);
    const res = await app.request(
      new Request("http://localhost/api/auth/openai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: "   " }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("DELETE missing key returns 404", async () => {
    const { app } = await makeApp([authRoutes]);
    const res = await app.request(
      new Request("http://localhost/api/auth/openai", {
        method: "DELETE",
      })
    );
    expect(res.status).toBe(404);
  });
});
