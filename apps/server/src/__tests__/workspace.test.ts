import { describe, expect, it } from "bun:test";
import { workspaceRoutes } from "../routes/workspace.ts";
import { makeApp } from "./helpers.ts";

describe("workspace routes", () => {
  it("returns empty array initially", async () => {
    const { app } = await makeApp([workspaceRoutes]);
    const res = await app.handle(
      new Request("http://localhost/api/workspace/sessions")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("POST adds a session path and returns updated array", async () => {
    const { app } = await makeApp([workspaceRoutes]);
    const res = await app.handle(
      new Request("http://localhost/api/workspace/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionPath: "/tmp/test-session" }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toContain("/tmp/test-session");
  });

  it("duplicate POST is idempotent", async () => {
    const { app } = await makeApp([workspaceRoutes]);
    await app.handle(
      new Request("http://localhost/api/workspace/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionPath: "/tmp/dup" }),
      })
    );
    const res2 = await app.handle(
      new Request("http://localhost/api/workspace/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionPath: "/tmp/dup" }),
      })
    );
    const body2 = await res2.json();
    // Should appear only once
    const count = body2.filter((p: string) => p === "/tmp/dup").length;
    expect(count).toBe(1);
  });

  it("DELETE removes a session path", async () => {
    const { app } = await makeApp([workspaceRoutes]);
    // Add first
    await app.handle(
      new Request("http://localhost/api/workspace/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionPath: "/tmp/to-delete" }),
      })
    );
    // Delete
    const res = await app.handle(
      new Request(
        `http://localhost/api/workspace/sessions/${encodeURIComponent("/tmp/to-delete")}`,
        { method: "DELETE" }
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toContain("/tmp/to-delete");
  });

  it("DELETE on non-existent path is idempotent", async () => {
    const { app } = await makeApp([workspaceRoutes]);
    const res = await app.handle(
      new Request(
        `http://localhost/api/workspace/sessions/${encodeURIComponent("/tmp/nope")}`,
        { method: "DELETE" }
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });
});
