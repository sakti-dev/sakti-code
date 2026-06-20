import { describe, expect, it } from "bun:test";
import { commandsRoutes } from "../routes/commands.ts";
import { makeApp } from "./helpers.ts";

describe("session commands routes", () => {
  it("returns commands array", async () => {
    const { app } = await makeApp([commandsRoutes]);

    const res = await app.handle(new Request("http://localhost/api/commands"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("commands");
    expect(Array.isArray(body.commands)).toBe(true);
    expect(body.commands.length).toBeGreaterThanOrEqual(4);

    const names = body.commands.map((c: { name: string }) => c.name);
    expect(names).toContain("search");
    expect(names).toContain("clear");
    expect(names).toContain("compact");
    expect(names).toContain("help");
  });

  it("each command has name and description", async () => {
    const { app } = await makeApp([commandsRoutes]);

    const res = await app.handle(new Request("http://localhost/api/commands"));
    const body = await res.json();
    for (const cmd of body.commands) {
      expect(typeof cmd.name).toBe("string");
      expect(cmd.name.length).toBeGreaterThan(0);
      expect(typeof cmd.description).toBe("string");
      expect(cmd.description.length).toBeGreaterThan(0);
    }
  });
});
