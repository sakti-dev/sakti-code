import { describe, expect, it } from "vitest";
import { settingsRoutes } from "../routes/settings.ts";
import { makeApp } from "./helpers.ts";

describe("settings routes", () => {
  it("PUT then GET round-trips a setting", async () => {
    const { app } = await makeApp([settingsRoutes]);
    const put = await app.request(
      new Request("http://localhost:3001/api/settings/theme", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "dark" }),
      })
    );
    expect(put.status).toBe(204);
    const got = await (
      await app.request(new Request("http://localhost:3001/api/settings/theme"))
    ).text();
    expect(got).toBe("dark");
  });

  it("returns 404 for unknown key", async () => {
    const { app } = await makeApp([settingsRoutes]);
    const res = await app.request(
      new Request("http://localhost:3001/api/settings/nonexistent")
    );
    expect(res.status).toBe(404);
  });
});
