import { describe, expect, it } from "vite-plus/test";
import { healthRoutes } from "../routes/health.ts";
import { makeApp } from "./helpers.ts";

describe("GET /health", () => {
  it("returns status ok with uptime", async () => {
    const { app } = await makeApp([healthRoutes]);
    const res = await app.request(
      new Request("http://localhost:3001/api/health")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
  });
});
