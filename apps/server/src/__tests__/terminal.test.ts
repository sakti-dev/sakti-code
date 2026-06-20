import { describe, expect, it } from "bun:test";
import {
  registerTestConnection,
  unregisterTestConnection,
} from "../agent/ws.ts";
import { terminalRoutes } from "../routes/terminals.ts";
import { makeApp } from "./helpers.ts";

const CONN_ID = "term-test-conn";

// Helper: create a terminal against a registered test connection.
// Terminals push their data/exit frames over WS keyed by connectionId, so a
// connection MUST be open before a terminal can be created.
async function createTerminal(
  app: { handle: (req: Request) => Promise<Response> },
  bodyOverrides: Record<string, unknown> = {}
) {
  return app.handle(
    new Request("http://localhost/api/terminals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionId: CONN_ID, ...bodyOverrides }),
    })
  );
}

describe("terminal routes", () => {
  // Each test registers/cleans up its own connection so the suite is isolated.
  function withConnection(fn: () => Promise<void>) {
    return async () => {
      registerTestConnection(CONN_ID, { send: () => {} });
      try {
        await fn();
      } finally {
        unregisterTestConnection(CONN_ID);
      }
    };
  }

  it(
    "POST /api/terminals creates a new terminal",
    withConnection(async () => {
      const { app } = await makeApp([terminalRoutes]);
      const res = await createTerminal(app, { cwd: "/tmp" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("terminalId");
      expect(body).toHaveProperty("pid");
      expect(typeof body.terminalId).toBe("string");
      expect(typeof body.pid).toBe("number");
    })
  );

  it("C3: POST /api/terminals without a valid connectionId is rejected (400)", async () => {
    const { app } = await makeApp([terminalRoutes]);
    // No connection registered for this id → cannot push → 400.
    const res = await app.handle(
      new Request("http://localhost/api/terminals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: "bogus", cwd: "/tmp" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it(
    "POST /api/terminals/:id/write writes to terminal",
    withConnection(async () => {
      const { app } = await makeApp([terminalRoutes]);
      const createRes = await createTerminal(app, { cwd: "/tmp" });
      const { terminalId } = await createRes.json();

      const res = await app.handle(
        new Request(`http://localhost/api/terminals/${terminalId}/write`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ data: "echo hello\n" }),
        })
      );
      expect(res.status).toBe(200);
    })
  );

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

  it(
    "POST /api/terminals/:id/resize resizes terminal",
    withConnection(async () => {
      const { app } = await makeApp([terminalRoutes]);
      const createRes = await createTerminal(app, {
        cwd: "/tmp",
        cols: 80,
        rows: 24,
      });
      const { terminalId } = await createRes.json();

      const res = await app.handle(
        new Request(`http://localhost/api/terminals/${terminalId}/resize`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cols: 120, rows: 40 }),
        })
      );
      expect(res.status).toBe(200);
    })
  );

  it(
    "DELETE /api/terminals/:id closes terminal",
    withConnection(async () => {
      const { app } = await makeApp([terminalRoutes]);
      const createRes = await createTerminal(app, { cwd: "/tmp" });
      const { terminalId } = await createRes.json();

      const res = await app.handle(
        new Request(`http://localhost/api/terminals/${terminalId}`, {
          method: "DELETE",
        })
      );
      expect(res.status).toBe(200);
    })
  );

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
