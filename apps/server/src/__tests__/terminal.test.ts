import { describe, expect, it } from "bun:test";
import { terminalRoutes } from "../routes/terminals.ts";
import { makeApp } from "./helpers.ts";

describe("terminal routes", () => {
  it("POST /api/terminals creates a new terminal", async () => {
    const { app } = await makeApp([terminalRoutes]);
    const res = await app.handle(
      new Request("http://localhost/api/terminals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd: "/tmp" }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("terminalId");
    expect(body).toHaveProperty("pid");
    expect(typeof body.terminalId).toBe("string");
    expect(typeof body.pid).toBe("number");
  });

  it("POST /api/terminals/:id/write writes to terminal", async () => {
    const { app } = await makeApp([terminalRoutes]);
    const createRes = await app.handle(
      new Request("http://localhost/api/terminals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd: "/tmp" }),
      })
    );
    const { terminalId } = await createRes.json();

    const res = await app.handle(
      new Request(`http://localhost/api/terminals/${terminalId}/write`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: "echo hello\n" }),
      })
    );
    expect(res.status).toBe(200);
  });

  it("POST /api/terminals/nope/write returns 404", async () => {
    const { app } = await makeApp([terminalRoutes]);
    const res = await app.handle(
      new Request("http://localhost/api/terminals/nope/write", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: "echo hello\n" }),
      })
    );
    expect(res.status).toBe(404);
  });

  it("POST /api/terminals/:id/resize resizes terminal", async () => {
    const { app } = await makeApp([terminalRoutes]);
    const createRes = await app.handle(
      new Request("http://localhost/api/terminals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd: "/tmp", cols: 80, rows: 24 }),
      })
    );
    const { terminalId } = await createRes.json();

    const res = await app.handle(
      new Request(`http://localhost/api/terminals/${terminalId}/resize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cols: 120, rows: 40 }),
      })
    );
    expect(res.status).toBe(200);
  });

  it("DELETE /api/terminals/:id closes terminal", async () => {
    const { app } = await makeApp([terminalRoutes]);
    const createRes = await app.handle(
      new Request("http://localhost/api/terminals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd: "/tmp" }),
      })
    );
    const { terminalId } = await createRes.json();

    const res = await app.handle(
      new Request(`http://localhost/api/terminals/${terminalId}`, {
        method: "DELETE",
      })
    );
    expect(res.status).toBe(200);
  });

  it("DELETE /api/terminals/nope returns 404", async () => {
    const { app } = await makeApp([terminalRoutes]);
    const res = await app.handle(
      new Request("http://localhost/api/terminals/nope", {
        method: "DELETE",
      })
    );
    expect(res.status).toBe(404);
  });
});
