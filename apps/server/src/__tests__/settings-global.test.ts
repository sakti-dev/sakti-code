import { describe, expect, it } from "vite-plus/test";
import { settingsRoutes } from "../routes/settings.ts";
import { makeApp } from "./helpers.ts";

describe("global settings routes (file-backed)", () => {
  it("GET returns empty object initially", async () => {
    const { app } = await makeApp([settingsRoutes]);
    const res = await app.request(new Request("http://localhost/api/settings"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({});
  });

  it("PUT then GET round-trips via file", async () => {
    const { app } = await makeApp([settingsRoutes]);
    const put = await app.request(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme: "dark" }),
      }),
    );
    expect(put.status).toBe(204);

    const res = await app.request(new Request("http://localhost/api/settings"));
    const body = await res.json();
    expect(body.theme).toBe("dark");
  });

  it("PUT deep-merges nested objects", async () => {
    const { app } = await makeApp([settingsRoutes]);
    await app.request(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ui: { theme: "dark" } }),
      }),
    );
    await app.request(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ui: { fontSize: 14 } }),
      }),
    );

    const res = await app.request(new Request("http://localhost/api/settings"));
    const body = await res.json();
    expect(body.ui).toEqual({ theme: "dark", fontSize: 14 });
  });

  it("PUT malformed JSON returns 400", async () => {
    const { app } = await makeApp([settingsRoutes]);
    const res = await app.request(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "{ broken",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("PUT non-object body returns 400", async () => {
    const { app } = await makeApp([settingsRoutes]);
    const res = await app.request(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([1, 2, 3]),
      }),
    );
    expect(res.status).toBe(400);
  });
});
