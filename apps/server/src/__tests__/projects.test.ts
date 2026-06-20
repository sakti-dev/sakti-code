import { describe, expect, it } from "bun:test";
import { projectsRoutes } from "../routes/projects.ts";
import { makeApp } from "./helpers.ts";

describe("projects routes", () => {
  it("POST then GET lists the project", async () => {
    const { app } = await makeApp([projectsRoutes]);
    const created = await app.handle(
      new Request("http://localhost:3001/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "demo", cwd: "/tmp/demo" }),
      })
    );
    expect(created.status).toBe(200);
    const project = await created.json();
    expect(project.name).toBe("demo");
    expect(project.cwd).toBe("/tmp/demo");
    expect(typeof project.id).toBe("string");

    const list = await (
      await app.handle(new Request("http://localhost:3001/api/projects"))
    ).json();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(project.id);
  });

  it("GET /:id returns 404 for unknown id", async () => {
    const { app } = await makeApp([projectsRoutes]);
    const res = await app.handle(
      new Request("http://localhost:3001/api/projects/nope")
    );
    expect(res.status).toBe(404);
  });
});
