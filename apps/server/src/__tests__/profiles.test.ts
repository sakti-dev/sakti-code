import { describe, expect, it } from "vitest";
import type { Profiles } from "../lib/profiles-store.ts";
import { profilesRoutes } from "../routes/profiles.ts";
import { makeApp } from "./helpers.ts";

const VALID_PROFILES: Profiles = {
  defaultProfile: "balanced",
  profiles: {
    balanced: {
      name: "Balanced",
      models: {
        default: { provider: "anthropic", model: "claude-sonnet-4-5" },
      },
    },
  },
};

describe("profiles routes", () => {
  it("GET returns parsed profiles", async () => {
    const { app } = await makeApp([profilesRoutes]);
    const res = await app.request(new Request("http://localhost/api/profiles"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.defaultProfile).toBeDefined();
    expect(body.profiles).toBeDefined();
  });

  it("PUT replaces the file, GET returns new content", async () => {
    const { app } = await makeApp([profilesRoutes]);
    const put = await app.request(
      new Request("http://localhost/api/profiles", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(VALID_PROFILES),
      })
    );
    expect(put.status).toBe(204);

    const res = await app.request(new Request("http://localhost/api/profiles"));
    const body = await res.json();
    expect(body).toEqual(VALID_PROFILES);
  });

  it("PUT with invalid body returns 400 and file unchanged", async () => {
    const { app, ctx } = await makeApp([profilesRoutes]);

    // Write valid profiles first
    ctx.profiles.writeAll(VALID_PROFILES);
    const original = ctx.profiles.read();

    const put = await app.request(
      new Request("http://localhost/api/profiles", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ defaultProfile: "missing", profiles: {} }),
      })
    );
    expect(put.status).toBe(400);
    expect(ctx.profiles.read()).toEqual(original);
  });

  it("PUT with malformed JSON returns 400", async () => {
    const { app } = await makeApp([profilesRoutes]);
    const put = await app.request(
      new Request("http://localhost/api/profiles", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "{ broken",
      })
    );
    expect(put.status).toBe(400);
  });
});
